/**
 * DecisionStats —— 决策统计服务
 *
 * 职责:
 *   1. 维护一组按口径计数的数字(totalIntents / requirements / tasks / ...)
 *   2. 提供增量式 record() 方法(每次状态变化精确加减)
 *   3. 提供 rebuild() 方法(从全量 tasks 重新算,用于会话切换/初始化)
 *   4. emit stats/updated 事件 + DecisionLog 事件给前端
 *
 * 口径定义(这是**唯一权威**,所有数字都按这个算,前后端一致):
 *
 *  ┌─────────────────────────────────────────────────────────────────┐
 *  │ LLM 意图层                                                       │
 *  │   totalIntents   = LLM 输出过的意图总数(含被过滤掉的)              │
 *  │   requirements   = LLM 输出中真属于产品需求的                     │
 *  │                     (add-feature/modify-feature/                 │
 *  │                      delete-feature/fix-bug/data-change)         │
 *  │   chitchat       = 非需求意图                                     │
 *  │                     (discussion/unclear)                         │
 *  │   注:approval/reject/defer 单独走"决策动作"通道,不计入上面          │
 *  ├─────────────────────────────────────────────────────────────────┤
 *  │ Task 状态层                                                       │
 *  │   tasks          = 进入 TaskQueue 的 task 总数                    │
 *  │                     (含所有终态 + superseded)                     │
 *  │   byStatus       = 各状态的当前快照(随时可读)                     │
 *  │   evaluating     = byStatus.analyzing                             │
 *  │   executable     = byStatus.confirmed + executing + completed     │
 *  │                     (已通过可行性评估的任务)                       │
 *  │   queued         = 当前调度队列长度(实时)                         │
 *  ├─────────────────────────────────────────────────────────────────┤
 *  │ 拒绝细分                                                          │
 *  │   rejected.byFeasibility = 可行性评估失败(超范围/高风险/不可行)    │
 *  │   rejected.byUser        = 用户驳回(LLM 输出 reject/rejects)      │
 *  │   rejected.bySystem      = 触发引擎兜底拒绝(infeasible 等)        │
 *  │   rejected.total         = byStatus.rejected 当前快照             │
 *  ├─────────────────────────────────────────────────────────────────┤
 *  │ 执行细分                                                          │
 *  │   executions.completed  = byStatus.completed 终态累积             │
 *  │   executions.failed     = byStatus.failed 终态累积                │
 *  └─────────────────────────────────────────────────────────────────┘
 *
 * 数字一致性保证:
 *  - 增量式 record() 同时记录"为什么变化"(DecisionLog),保证可追溯
 *  - rebuild() 用来纠错(任何一次记录丢失都能从全量 rebuild 修正)
 */
import { logger } from '../logger.js'
import type {
  DecisionStats,
  DecisionLogEntry,
  Feasibility,
  TaskStatus,
  TaskIntent,
  AsrChunk,
} from '../types/task.js'
import { nanoid } from 'nanoid'

/** LLM 输出的"产品需求类"意图 */
const REQUIREMENT_INTENTS: ReadonlySet<TaskIntent> = new Set([
  'add-feature',
  'modify-feature',
  'delete-feature',
  'fix-bug',
  'data-change',
])

/** 非需求类意图(讨论 / 不清晰) */
const CHITCHAT_INTENTS: ReadonlySet<TaskIntent> = new Set([
  'discussion',
  'unclear',
])

/**
 * 内部记录的"原始计数",基于增量事件追加。
 *
 * 这里存的是**绝对值**。每次状态变化用绝对值覆盖,而不是加减,
 * 这样可以保证数字跟 tasks 对得上 —— 因为 tasks 可能新增/删除。
 */
interface InternalCounts {
  totalIntents: number
  requirements: number
  chitchat: number
  // 决策层指标:LLM 评估结果,不可变
  feasible: number
  infeasible: number
  // 执行层指标:task 状态聚合
  rejectedByFeasibility: number
  rejectedByUser: number
  rejectedBySystem: number
  executionsCompleted: number
  executionsFailed: number
}

function emptyCounts(): InternalCounts {
  return {
    totalIntents: 0,
    requirements: 0,
    chitchat: 0,
    feasible: 0,
    infeasible: 0,
    rejectedByFeasibility: 0,
    rejectedByUser: 0,
    rejectedBySystem: 0,
    executionsCompleted: 0,
    executionsFailed: 0,
  }
}

/** emit callback 类型(让 engine 把事件广播出去) */
export type StatsEmit = (event: { type: 'stats/updated'; data: DecisionStats }) => void
export type LogEmit = (event: { type: 'decision/log'; data: DecisionLogEntry }) => void

export interface DecisionStatsSnapshot {
  stats: DecisionStats
  log: DecisionLogEntry[]
}

export class DecisionStatsService {
  private counts: InternalCounts = emptyCounts()
  private byStatus: DecisionStats['byStatus'] = {
    detected: 0, analyzing: 0, confirmed: 0, executing: 0,
    completed: 0, failed: 0, rejected: 0, deferred: 0, superseded: 0,
  }
  private queuedCount = 0
  private version = 0
  private updatedAt = Date.now()
  private log: DecisionLogEntry[] = []
  /** 用于重建完整快照的 task 来源 */
  private readonly getTasksSnapshot: () => Array<{
    id: string
    status: TaskStatus
    intent: TaskIntent
    feasibility: Feasibility
    completedAt?: number
    modifiedFiles?: string[]
    rejectionReason?: string
    currentChunkId?: string
  }>

  constructor(
    private readonly statsEmitter: StatsEmit,
    private readonly logEmitter: LogEmit,
    getTasksSnapshot: DecisionStatsService['getTasksSnapshot'],
  ) {
    this.getTasksSnapshot = getTasksSnapshot
  }

  /** 当前快照(给外部直接读) */
  snapshot(): DecisionStats {
    return this.buildStats()
  }

  /** 当前决策日志(只读副本) */
  getLog(): readonly DecisionLogEntry[] {
    return [...this.log]
  }

  /** 完全清空 + 重新从 tasks 算(用于 reset / 新会话) */
  rebuildFromTasks(): void {
    this.counts = emptyCounts()
    this.byStatus = {
      detected: 0, analyzing: 0, confirmed: 0, executing: 0,
      completed: 0, failed: 0, rejected: 0, deferred: 0, superseded: 0,
    }
    this.log = []

    // 扫所有 task,把"已经累积的状态"重新计一遍
    const tasks = this.getTasksSnapshot()
    for (const t of tasks) {
      this.byStatus[t.status]++
      // 终态数字从 byStatus 推算即可 —— 拒绝细分得另算
      if (t.status === 'rejected') {
        // 根据 reasoning 推断来源
        this.classifyRejection(t)
      }
    }

    // 完成 / 失败 = byStatus 直接读
    this.counts.executionsCompleted = this.byStatus.completed
    this.counts.executionsFailed = this.byStatus.failed

    // 重建后默认没看到 LLM intent 数据,所以这些保持 0
    // (LLM intent 数据用 record*() 增量加,rebuild 不能凭空算)

    this.bumpVersion()
  }

  /** 清空日志(不重置数字) —— reset 时也会清 */
  clearLog(): void {
    this.log = []
    this.bumpVersion()
  }

  /** 完全清空所有计数和日志(新会话开始) */
  reset(): void {
    this.counts = emptyCounts()
    this.byStatus = {
      detected: 0, analyzing: 0, confirmed: 0, executing: 0,
      completed: 0, failed: 0, rejected: 0, deferred: 0, superseded: 0,
    }
    this.queuedCount = 0
    this.log = []
    this.version++
    this.updatedAt = Date.now()
    this.flush()
  }

  // ===== 增量记录方法 =====
  // 每个方法都精确改一个数字 + 写一条 DecisionLog + bumpVersion

  /**
   * 记录一次 LLM 意图提取
   * @param intents LLM 输出的全部意图(可能为空数组)
   */
  recordIntents(chunkId: string, rawText: string, intents: Array<{
    intent: string  // 接受任意字符串(LLM 可能输出 approval/rejection/defer/unclear)
    rawText: string
    interpreted: string
    target: string | null
    confidence: number
    relationTo: { taskId: string | null; type: string | null } | null
    reasoning: string
  }>, speaker: string | null): void {
    this.counts.totalIntents += intents.length
    for (const i of intents) {
      if (REQUIREMENT_INTENTS.has(i.intent as TaskIntent)) {
        this.counts.requirements++
      } else if (CHITCHAT_INTENTS.has(i.intent as TaskIntent)) {
        this.counts.chitchat++
      }
      // approval/reject/defer 不计入(它们是"对已有 task 的决策动作",单独统计)
    }

    // 写决策日志(每个意图一条)
    for (const i of intents) {
      this.appendLog({
        type: 'intent_extracted',
        taskId: null,
        chunkId,
        speaker,
        rawText: i.rawText,
        reasoning: i.reasoning,
        beforeStatus: null,
        afterStatus: null,
        details: {
          intent: i.intent,
          target: i.target,
          confidence: i.confidence,
          mentionCount: 1,
        },
      })
    }

    this.bumpVersion()
  }

  /** 记录新建 task */
  recordTaskCreated(args: {
    taskId: string
    chunkId: string
    speaker: string | null
    rawText: string
    intent: string  // 接受任意字符串(LLM 输出去重后的 stat)
    target: string | null
    confidence: number
    reasoning: string
  }): void {
    this.byStatus.detected++

    this.appendLog({
      type: 'task_created',
      taskId: args.taskId,
      chunkId: args.chunkId,
      speaker: args.speaker,
      rawText: args.rawText,
      reasoning: args.reasoning,
      beforeStatus: null,
      afterStatus: 'detected',
      details: {
        intent: args.intent,
        target: args.target,
        confidence: args.confidence,
      },
    })

    this.bumpVersion()
  }

  /** 记录去重合并(已存在) */
  recordTaskDeduped(args: {
    taskId: string
    chunkId: string
    speaker: string | null
    rawText: string
    reason: 'exact' | 'semantic' | 'approval-merged'
    existingMentionCount: number
    reasoning: string
  }): void {
    // byStatus 不变,只是 mentionCount++
    this.appendLog({
      type: 'task_deduped',
      taskId: args.taskId,
      chunkId: args.chunkId,
      speaker: args.speaker,
      rawText: args.rawText,
      reasoning: args.reasoning,
      beforeStatus: null,
      afterStatus: null,
      details: { mentionCount: args.existingMentionCount + 1 },
    })

    this.bumpVersion()
  }

  /** 记录用户确认(approval) */
  recordTaskApproved(args: {
    taskId: string
    chunkId: string
    speaker: string | null
    rawText: string
    reasoning: string
    mentionCount: number
  }): void {
    this.appendLog({
      type: 'task_approved',
      taskId: args.taskId,
      chunkId: args.chunkId,
      speaker: args.speaker,
      rawText: args.rawText,
      reasoning: args.reasoning,
      beforeStatus: null,
      afterStatus: null,
      details: { mentionCount: args.mentionCount },
    })

    this.bumpVersion()
  }

  /** 记录用户驳回(reject) */
  recordTaskRejectedByUser(args: {
    taskId: string
    chunkId: string
    speaker: string | null
    rawText: string
    reasoning: string
    fromStatus: TaskStatus
  }): void {
    this.transition(args.fromStatus, 'rejected')
    this.counts.rejectedByUser++

    this.appendLog({
      type: 'task_rejected',
      taskId: args.taskId,
      chunkId: args.chunkId,
      speaker: args.speaker,
      rawText: args.rawText,
      reasoning: args.reasoning,
      beforeStatus: args.fromStatus,
      afterStatus: 'rejected',
    })

    this.bumpVersion()
  }

  /** 记录用户暂存(defer) */
  recordTaskDeferred(args: {
    taskId: string
    chunkId: string
    speaker: string | null
    rawText: string
    reasoning: string
    fromStatus: TaskStatus
  }): void {
    this.transition(args.fromStatus, 'deferred')

    this.appendLog({
      type: 'task_deferred',
      taskId: args.taskId,
      chunkId: args.chunkId,
      speaker: args.speaker,
      rawText: args.rawText,
      reasoning: args.reasoning,
      beforeStatus: args.fromStatus,
      afterStatus: 'deferred',
    })

    this.bumpVersion()
  }

  /** 记录被新需求取代(superseded) */
  recordTaskSuperseded(args: {
    taskId: string
    newTaskId: string
    chunkId: string
    speaker: string | null
    rawText: string
    reasoning: string
    fromStatus: TaskStatus
  }): void {
    this.transition(args.fromStatus, 'superseded')

    this.appendLog({
      type: 'task_superseded',
      taskId: args.taskId,
      chunkId: args.chunkId,
      speaker: args.speaker,
      rawText: args.rawText,
      reasoning: `${args.reasoning} (被 #${args.newTaskId.slice(0, 6)} 取代)`,
      beforeStatus: args.fromStatus,
      afterStatus: 'superseded',
    })

    this.bumpVersion()
  }

  /** 记录可行性评估完成 */
  recordFeasibilityEvaluated(args: {
    taskId: string
    chunkId: string | null
    speaker: string | null
    rawText: string | null
    fromStatus: TaskStatus
    feasibility: Feasibility
    /** 评估结果是否通过 */
    passed: boolean
    /** 通过评估后变成什么状态(confirmed / deferred / rejected) */
    nextStatus: TaskStatus
    reasoning: string
  }): void {
    // 安全护栏:如果 fromStatus === nextStatus,不 transition(状态没变),
    // 但仍然记录日志和 update counters
    if (args.fromStatus !== args.nextStatus) {
      this.transition(args.fromStatus, args.nextStatus)
    }

    // ★ 决策层指标:LLM 评估结果(不可变,跟 task 后续状态脱钩)
    // 组合判定:retained + inWhitelist + risk!='high' + workload!='large'
    const isLlmFeasible =
      args.feasibility.technical === 'feasible' &&
      args.feasibility.inWhitelist &&
      args.feasibility.riskLevel !== 'high' &&
      args.feasibility.workload !== 'large'

    if (isLlmFeasible) {
      this.counts.feasible++
    } else {
      this.counts.infeasible++
    }

    // 执行层指标:被可行性直接拒绝的 task
    if (args.nextStatus === 'rejected') {
      this.counts.rejectedByFeasibility++
    }

    this.appendLog({
      type: 'feasibility_evaluated',
      taskId: args.taskId,
      chunkId: args.chunkId,
      speaker: args.speaker,
      rawText: args.rawText,
      reasoning: args.reasoning,
      beforeStatus: args.fromStatus,
      afterStatus: args.nextStatus,
      details: { feasibility: args.feasibility },
    })

    this.bumpVersion()
  }

  /** 记录进入执行(executing) */
  recordTaskExecuting(args: {
    taskId: string
    fromStatus: TaskStatus
  }): void {
    this.transition(args.fromStatus, 'executing')
    // queued 队列减少(下一个被取走)
    if (this.queuedCount > 0) this.queuedCount--

    this.appendLog({
      type: 'task_executing',
      taskId: args.taskId,
      chunkId: null,
      speaker: null,
      rawText: null,
      reasoning: null,
      beforeStatus: args.fromStatus,
      afterStatus: 'executing',
    })

    this.bumpVersion()
  }

  /** 记录执行完成 */
  recordTaskCompleted(args: {
    taskId: string
    modifiedFiles: string[]
    duration: number
  }): void {
    this.transition('executing', 'completed')
    this.counts.executionsCompleted++

    this.appendLog({
      type: 'task_completed',
      taskId: args.taskId,
      chunkId: null,
      speaker: null,
      rawText: null,
      reasoning: null,
      beforeStatus: 'executing',
      afterStatus: 'completed',
      details: { modifiedFiles: args.modifiedFiles },
    })

    this.bumpVersion()
  }

  /** 记录执行失败 */
  recordTaskFailed(args: {
    taskId: string
    error: string
  }): void {
    this.transition('executing', 'failed')
    this.counts.executionsFailed++

    this.appendLog({
      type: 'task_failed',
      taskId: args.taskId,
      chunkId: null,
      speaker: null,
      rawText: null,
      reasoning: null,
      beforeStatus: 'executing',
      afterStatus: 'failed',
      details: { error: args.error },
    })

    this.bumpVersion()
  }

  /** 调度队列长度变化(Scheduler 调用) */
  setQueuedCount(n: number): void {
    if (this.queuedCount === n) return
    this.queuedCount = n
    this.bumpVersion()
  }

  /**
   * 通用状态转换(给 engine 在所有 taskQueue.setStatus 调用前用)
   *
   * 不会像 transition 那样内部 bumpVersion —— 因为上层方法会自己 bump
   * 但是会同步 byStatus 计数。
   */
  transitionStatus(taskId: string, fromStatus: TaskStatus, toStatus: TaskStatus): void {
    if (fromStatus === toStatus) return
    // 不写日志,只是同步计数
    if (this.byStatus[fromStatus] > 0) {
      this.byStatus[fromStatus]--
    }
    this.byStatus[toStatus]++
  }

  // ===== 私有 =====

  private transition(from: TaskStatus, to: TaskStatus): void {
    if (from === to) return
    // 防负保护:from 状态可能已被别的 transition 改过
    if (this.byStatus[from] > 0) {
      this.byStatus[from]--
    } else {
      logger.warn({ from, to }, 'transition from empty status counter (consistency drift, will be fixed on next rebuild)')
    }
    this.byStatus[to]++
  }

  /** 把 rejected task 按 reasoning 推断来源(rebuild 时用) */
  private classifyRejection(t: {
    rejectionReason?: string
  }): void {
    const reason = t.rejectionReason || ''
    if (reason.includes('超出允许范围') || reason.includes('风险等级高') || reason.includes('工作量较大')) {
      this.counts.rejectedByFeasibility++
    } else if (reason.includes('被驳回') || reason.includes('用户驳回') || reason.includes('手动取消')) {
      this.counts.rejectedByUser++
    } else {
      // 默认归 feasibility(因为大部分拒绝来自可行性评估)
      this.counts.rejectedByFeasibility++
    }
  }

  private appendLog(entry: Omit<DecisionLogEntry, 'id' | 'at'>): void {
    const full: DecisionLogEntry = {
      id: nanoid(8),
      at: Date.now(),
      ...entry,
    }
    this.log.push(full)
    // 日志上限 200 条,避免内存膨胀
    if (this.log.length > 200) {
      this.log = this.log.slice(-200)
    }
    this.logEmitter({ type: 'decision/log', data: full })
  }

  private bumpVersion(): void {
    this.version++
    this.updatedAt = Date.now()
    this.flush()
  }

  /** 推一份最新 stats 给前端 */
  private flush(): void {
    this.statsEmitter({ type: 'stats/updated', data: this.buildStats() })
  }

  private buildStats(): DecisionStats {
    return {
      version: this.version,
      totalIntents: this.counts.totalIntents,
      requirements: this.counts.requirements,
      chitchat: this.counts.chitchat,
      // 决策层指标
      feasible: this.counts.feasible,
      infeasible: this.counts.infeasible,
      tasks: Object.values(this.byStatus).reduce((s, n) => s + n, 0),
      byStatus: { ...this.byStatus },
      evaluating: this.byStatus.analyzing,
      executable: this.byStatus.confirmed + this.byStatus.executing + this.byStatus.completed,
      queued: this.queuedCount,
      rejected: {
        total: this.byStatus.rejected,
        byFeasibility: this.counts.rejectedByFeasibility,
        byUser: this.counts.rejectedByUser,
        bySystem: this.counts.rejectedBySystem,
      },
      executions: {
        completed: this.counts.executionsCompleted,
        failed: this.counts.executionsFailed,
      },
      updatedAt: this.updatedAt,
    }
  }
}

/**
 * 给前端用的反向工具 —— 用 stats 计算漏斗表达式
 *
 * 漏斗(total → chitchat → requirements → tasks → evaluating → executable → done):
 *   LLM 意图 → 实际建 task → 评估 → 通过 → 执行 → 完成
 *
 * 不放进 stats 本身(避免数据冗余),由前端在渲染时计算
 */
export function deriveFunnel(stats: DecisionStats): Array<{ label: string; value: number; hint?: string }> {
  return [
    { label: 'LLM 意图', value: stats.totalIntents, hint: '所有意图总数(含非需求)' },
    { label: '产品需求', value: stats.requirements, hint: 'add/modify/delete/fix/data' },
    { label: '非需求', value: stats.chitchat, hint: 'discussion/unclear' },
    { label: '已建 task', value: stats.tasks, hint: '进入 TaskQueue 的总数' },
    { label: '评估中', value: stats.evaluating, hint: '正在评估可行性' },
    { label: '可开发', value: stats.executable, hint: 'confirmed + executing + completed' },
    { label: '执行中', value: stats.byStatus.executing, hint: '执行层在跑' },
    { label: '已完成', value: stats.executions.completed, hint: '执行成功' },
    { label: '失败', value: stats.executions.failed, hint: '执行失败' },
    { label: '拒绝', value: stats.rejected.total, hint: `可行性 ${stats.rejected.byFeasibility} · 用户 ${stats.rejected.byUser}` },
  ]
}

/**
 * 暴露给 engine 的"已发生的所有决策数",从内部 counts 反推
 * 仅供调试或日志用,不参与口径
 */
export function debugInternalCounts(svc: DecisionStatsService): InternalCounts {
  // 通过类型 hack 拿 —— 不优雅,但避免把 InternalCounts export 出去污染类型
  const internal = svc as unknown as { counts: InternalCounts }
  return internal.counts
}

// ===== 类型窄化辅助(供 engine 调用方用) =====

/** 把 AsrChunk 收窄成 stats service 用的最小字段 */
export function asrChunkMinimal(chunk: AsrChunk): { id: string; speaker: string; text: string } {
  return { id: chunk.id, speaker: chunk.speaker, text: chunk.text }
}
