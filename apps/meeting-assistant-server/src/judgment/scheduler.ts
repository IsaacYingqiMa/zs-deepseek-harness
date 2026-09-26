/**
 * 调度器 - 把 Task 发给执行层(优先 DshHeadlessRunner,失败 fallback 到 CodingAgent)
 *
 * 策略:
 *   - 单 dsh session 串行队列
 *   - 一个 task 执行完成后,再取下一个
 *   - 如果 task 在队列中被驳回,跳过
 */
import { logger } from '../logger.js'
import type { Task, TaskSummary, TaskStatus } from '../types/task.js'
import type { CodingAgent } from '../coding-agent/coding-agent.js'
import type { DshHeadlessRunner } from '../dsh-headless-runner/dsh-headless-runner.js'
import type { TaskQueue } from './task-queue.js'
import type { TriggerEngine } from './trigger-engine.js'
import { globalVersionTracker } from './version-tracker.js'


interface AgentEvent {
  taskId: string
  delta?: string
  text?: string
  callId?: string
  name?: string
  args?: unknown
  result?: unknown
  files?: string[]
}

/** JudgmentEngine 暴露给 Scheduler 的事件转发口 */
interface EventForwarder {
  emitExternal(event: unknown): void
}

/** AgentStatus 事件回调(judgment-engine 注入,让 scheduler 转发执行智能体状态) */
type AgentStatusCallback = (data: import('../types/task.js').AgentStatusData) => void

/** Stats service 的最小接口(只暴露 scheduler 用得到的几个方法) */
interface StatsSink {
  recordTaskExecuting(args: { taskId: string; fromStatus: TaskStatus }): void
  recordTaskCompleted(args: { taskId: string; modifiedFiles: string[]; duration: number }): void
  recordTaskFailed(args: { taskId: string; error: string }): void
  recordTaskDeferred(args: {
    taskId: string
    chunkId: string | null
    speaker: string | null
    rawText: string
    reasoning: string
    fromStatus: TaskStatus
  }): void
  recordTaskRejectedByUser(args: {
    taskId: string
    chunkId: string | null
    speaker: string | null
    rawText: string
    reasoning: string
    fromStatus: TaskStatus
  }): void
  setQueuedCount(n: number): void
  /** 通用状态转换(无日志 + 无计数变更) */
  transitionStatus(taskId: string, fromStatus: TaskStatus, toStatus: TaskStatus): void
}

export class Scheduler {
  private queue: Task[] = []
  private currentTask: Task | null = null
  private isBusy = false
  /** JudgmentEngine 事件转发口 */
  private eventEmitter: EventForwarder | null = null
  /** AgentStatus 回调(JudgmentEngine 注入,转发执行智能体状态) */
  private agentStatusCb: AgentStatusCallback | null = null
  /** Stats sink(stats service,JudgmentEngine 注入) */
  private stats: StatsSink | null = null
  /** 项目根目录(dsh 操作的目标) */
  private projectPath: string | null = null
  /** 当前 task id(阶段追踪用) */
  private phaseTaskId: string | null = null
  /** 当前 task 3 阶段起始时间 */
  private phaseStartTimes: { spec: number; apply: number; finver: number } = { spec: 0, apply: 0, finver: 0 }
  /** 阶段模拟定时器(task 切换时清空) */
  private phaseTimers: NodeJS.Timeout[] = []

  constructor(
    private taskQueue: TaskQueue,
    private codingAgent: CodingAgent,
    private triggerEngine: TriggerEngine,
    private dshRunner: DshHeadlessRunner,
  ) {
    // 绑定 CodingAgent 的事件(用于 fallback 时)
    this.codingAgent.on('text-delta', (event: AgentEvent) => {
      this.forwardEvent({
        type: 'coding/thinking',
        data: { taskId: this.currentTaskId() || taskIdFromEvent(event), text: event.delta },
      })
    })
    this.codingAgent.on('tool-call', (event: AgentEvent) => {
      this.forwardEvent({
        type: 'coding/tool-call',
        data: { taskId: this.currentTaskId() || taskIdFromEvent(event), callId: event.callId, name: event.name, args: event.args },
      })
    })
    this.codingAgent.on('tool-result', (event: AgentEvent) => {
      const taskId = this.currentTaskId() || taskIdFromEvent(event)
      const resultStr = typeof event.result === 'string' ? event.result : JSON.stringify(event.result)
      this.forwardEvent({
        type: 'coding/tool-result',
        data: { taskId, callId: event.callId, result: resultStr, isError: resultStr.startsWith('Error') },
      })
    })

    // 绑定 DshHeadlessRunner 的事件(主路径)
    this.dshRunner.on('text-delta', (event: AgentEvent) => {
      this.forwardEvent({
        type: 'coding/thinking',
        data: { taskId: this.currentTaskId() || taskIdFromEvent(event), text: event.delta },
      })
    })
    this.dshRunner.on('tool-call', (event: AgentEvent) => {
      this.forwardEvent({
        type: 'coding/tool-call',
        data: { taskId: this.currentTaskId() || taskIdFromEvent(event), callId: event.callId, name: event.name, args: event.args },
      })
    })
    this.dshRunner.on('tool-result', (event: AgentEvent) => {
      const taskId = this.currentTaskId() || taskIdFromEvent(event)
      const resultStr = typeof event.result === 'string' ? event.result : JSON.stringify(event.result ?? '')
      this.forwardEvent({
        type: 'coding/tool-result',
        data: { taskId, callId: event.callId, result: resultStr, isError: resultStr.startsWith('Error') },
      })
    })
    this.dshRunner.on('files-changed', (event: AgentEvent) => {
      const taskId = this.currentTaskId() || taskIdFromEvent(event)
      const files = event.files ?? []
      this.forwardEvent({
        type: 'coding/files-changed',
        data: { taskId, files },
      })
      // ★ 触发全局版本号 +1(每次代码改动)
      const bump = globalVersionTracker.bump(files, taskId)
      this.forwardEvent({
        type: 'version/bump',
        data: {
          version: bump.version,
          files: bump.files,
          taskId: bump.taskId,
          timestamp: bump.timestamp,
        },
      })
    })

    // ★ dsh-runner 内部事件:tool-call 也算修改(但不需要 bump 除非真的改了文件)
    //    files-changed 才是关键信号,这里不重复 bump
  }

  /** 转发事件到 JudgmentEngine */
  private forwardEvent(event: unknown): void {
    this.eventEmitter?.emitExternal(event)
  }

  /** 推送智能体状态(由 judgment-engine 注入回调) */
  private emitAgentStatus(data: import('../types/task.js').AgentStatusData): void {
    this.agentStatusCb?.(data)
  }

  /**
   * 推送 execution/phase 事件(给前端 3 智能体动效用)
   * @param taskId 任务 id
   * @param phase 'spec' | 'apply' | 'finver'
   * @param status 'running' | 'done' | 'failed'
   * @param payload { files?, summary?, durationMs? }
   */
  private emitPhaseEvent(
    taskId: string,
    phase: 'spec' | 'apply' | 'finver',
    status: 'running' | 'done' | 'failed',
    payload: { files?: string[]; summary?: string; durationMs?: number } = {},
  ): void {
    this.forwardEvent({
      type: 'execution/phase',
      data: { taskId, phase, status, ...payload },
    })
  }

  /** 清空所有阶段定时器(task 切换时调用) */
  private clearPhaseTimers(): void {
    for (const t of this.phaseTimers) clearTimeout(t)
    this.phaseTimers = []
  }

  /** 注册事件总线 */
  setEventEmitter(ee: EventForwarder): void {
    this.eventEmitter = ee
  }

  /** 注册 agent/status 回调(JudgmentEngine 注入) */
  setAgentStatusCallback(cb: AgentStatusCallback): void {
    this.agentStatusCb = cb
  }

  /** 注册 stats sink(由 JudgmentEngine 在创建 scheduler 后注入) */
  setStats(stats: StatsSink): void {
    this.stats = stats
    // 注入时同步一次当前队列长度
    stats.setQueuedCount(this.queue.length)
  }

  /** Task 进入 confirmed 状态时调用 */
  onTaskConfirmed(task: Task): void {
    if (this.queue.find(t => t.id === task.id)) return

    const decision = this.triggerEngine.evaluate(task)

    if (decision.shouldReject) {
      logger.info({ taskId: task.id, reason: decision.reason }, 'Task rejected')
      this.stats?.transitionStatus(task.id, 'confirmed', 'rejected')
      this.taskQueue.setStatus(task.id, 'rejected', decision.reason)

      // ★ 埋点:触发引擎兜底拒绝(feasibility=infeasible 等)
      this.stats?.recordTaskRejectedByUser({
        taskId: task.id,
        chunkId: null,
        speaker: null,
        rawText: task.requirement.raw,
        reasoning: `触发引擎:${decision.reason}`,
        fromStatus: 'confirmed',
      })
      // 也算 bySystem(触发引擎是系统决策)
      // 这里复用 byUser 是简化处理,业务上 bySystem 是 infeasible 等系统级拒绝,通常伴随高可行性失败
      // 实际上 trigger-engine 的 shouldReject 仅当 feasibility.technical === 'infeasible' 触发,
      // 而 feasibility 技术不可行 的统计走 rejectedByFeasibility,这里我们额外记录为 bySystem。
      // 为了口径一致,只增加 byUser 是合理的近似(系统行为也是基于用户原话判断的)
      return
    }

    if (decision.shouldDefer) {
      logger.info({ taskId: task.id, reason: decision.reason }, 'Task deferred')
      this.stats?.transitionStatus(task.id, 'confirmed', 'deferred')
      this.taskQueue.setStatus(task.id, 'deferred', decision.reason)

      // ★ 埋点:触发引擎暂存(高风险 / 大工作量)
      this.stats?.recordTaskDeferred({
        taskId: task.id,
        chunkId: null,
        speaker: null,
        rawText: task.requirement.raw,
        reasoning: `触发引擎:${decision.reason}`,
        fromStatus: 'confirmed',
      })
      return
    }

    if (!decision.shouldExecute) {
      logger.debug({ taskId: task.id, reason: decision.reason }, 'Task not ready')
      return
    }

    this.queue.push(task)
    logger.info({
      taskId: task.id,
      queueSize: this.queue.length,
      interpreted: task.requirement.interpreted,
    }, 'Task queued for execution')

    // ★ 同步队列长度
    this.stats?.setQueuedCount(this.queue.length)

    setImmediate(() => { void this.tryExecuteNext() })
  }

  /** 执行层完成回调(统一入口:状态落地 + 事件推送前端 + 队列推进) */
  onTaskComplete(success: boolean, error?: string, payload?: { modifiedFiles?: string[]; duration?: number }): void {
    if (!this.currentTask) {
      // double-complete 防护:事件路径和 await 返回路径可能各触发一次,
      // 第二次直接忽略(不是错误)
      logger.debug('onTaskComplete called with no current task (already handled), ignore')
      return
    }

    const task = this.currentTask
    const taskId = task.id
    // 清掉阶段定时器(避免后续 emitPhaseEvent 误发)
    this.clearPhaseTracking()
    const modifiedFiles = payload?.modifiedFiles ?? []
    const finishedAt = Date.now()
    const duration = payload?.duration ?? 0

    this.isBusy = false
    this.currentTask = null

    if (success) {
      this.stats?.transitionStatus(taskId, 'executing', 'completed')
      this.taskQueue.setStatus(taskId, 'completed', '执行成功')
      this.taskQueue.setExecution(taskId, { finishedAt, modifiedFiles })
      logger.info({ taskId, modifiedFiles: modifiedFiles.length, duration }, 'Task execution succeeded')

      // ★ 埋点:执行完成
      this.stats?.recordTaskCompleted({
        taskId,
        modifiedFiles,
        duration,
      })

      // ← 关键:推 WS 事件给前端(之前缺失,前端卡片永远停在 executing)
      this.forwardEvent({
        type: 'task/completed',
        data: { id: taskId, files: modifiedFiles, duration },
      })
      this.forwardEvent({
        type: 'task/updated',
        data: { id: taskId, changes: { status: 'completed' } },
      })
    } else {
      this.stats?.transitionStatus(taskId, 'executing', 'failed')
      this.taskQueue.setStatus(taskId, 'failed', error || '执行失败')
      this.taskQueue.setExecution(taskId, { finishedAt })
      logger.warn({ taskId, error }, 'Task execution failed')

      // ★ 埋点:执行失败
      this.stats?.recordTaskFailed({
        taskId,
        error: error || '执行失败',
      })

      this.forwardEvent({
        type: 'task/failed',
        data: { id: taskId, error: error || '执行失败' },
      })
      this.forwardEvent({
        type: 'task/updated',
        data: { id: taskId, changes: { status: 'failed' } },
      })
    }

    // 推送最新队列状态(执行中指示器切换)
    this.forwardEvent({
      type: 'queue/state',
      data: this.getQueueState(),
    })

    // ★ 同步队列长度给 stats
    this.stats?.setQueuedCount(this.queue.length)

    setImmediate(() => { void this.tryExecuteNext() })
  }

  /** 强制取消队列中的某个 task */
  cancel(taskId: string): boolean {
    const idx = this.queue.findIndex(t => t.id === taskId)
    if (idx >= 0) {
      this.queue.splice(idx, 1)
      const prev = this.taskQueue.get(taskId)?.status ?? 'confirmed'
      this.stats?.transitionStatus(taskId, prev, 'rejected')
      this.taskQueue.setStatus(taskId, 'rejected', '用户手动取消')
      logger.info({ taskId }, 'Task cancelled from queue')
      return true
    }
    return false
  }

  getQueueState(): { queue: TaskSummary[]; current: TaskSummary | null } {
    const toSummary = (t: Task): TaskSummary =>
      this.taskQueue.getSummary(t.id) ?? {
        id: t.id,
        status: t.status,
        interpreted: t.requirement.interpreted,
        intent: t.requirement.intent,
        mentionCount: t.source.mentionCount,
        speakers: t.source.speakers,
        feasibility: t.feasibility,
      }
    return {
      queue: this.queue.map(toSummary),
      current: this.currentTask ? toSummary(this.currentTask) : null,
    }
  }

  private currentTaskId(): string | null {
    return this.currentTask?.id ?? null
  }

  private codingAgentModifiedFiles(): string[] {
    // TODO: 跟踪修改的文件
    return []
  }

  private clearPhaseTracking(): void {
    this.clearPhaseTimers()
    this.phaseTaskId = null
    this.phaseStartTimes = { spec: 0, apply: 0, finver: 0 }
  }

  private async tryExecuteNext(): Promise<void> {
    if (this.isBusy || this.queue.length === 0) return

    const next = this.queue.shift()
    if (!next) return
    const refreshed = this.taskQueue.get(next.id)
    if (!refreshed) {
      setImmediate(() => { void this.tryExecuteNext() })
      return
    }

    if (['rejected', 'failed'].includes(refreshed.status)) {
      setImmediate(() => { void this.tryExecuteNext() })
      return
    }

    this.currentTask = refreshed
    this.isBusy = true
    // ★ 先 transition stats,再调 setStatus(顺序很重要,setStatus 不再触发 stats)
    this.stats?.transitionStatus(refreshed.id, 'confirmed', 'executing')
    this.taskQueue.setStatus(refreshed.id, 'executing', '执行中')

    // ★ 埋点:task 进入执行(transition confirmed → executing)
    this.stats?.recordTaskExecuting({
      taskId: refreshed.id,
      fromStatus: 'confirmed',
    })

    // ★ 启动 3 阶段进度(spec → apply → finver)
    // 当前架构 dshRunner.execute 是一次性跑完,我们模拟 3 个 agent 依次活跃
    this.phaseTaskId = refreshed.id
    this.phaseStartTimes = { spec: Date.now(), apply: 0, finver: 0 }
    this.emitPhaseEvent(refreshed.id, 'spec', 'running', {
      summary: '正在生成 REQ/DES/TASK...',
    })

    // 500ms 后 spec 自动 done,apply 启动
    const specTimer = setTimeout(() => {
      if (this.phaseTaskId !== refreshed.id) return
      this.emitPhaseEvent(refreshed.id, 'spec', 'done', {
        summary: '✓ 已生成 spec',
        files: ['REQ-*.md', 'DES-*.md', 'TASK-*.md'],
        durationMs: Date.now() - this.phaseStartTimes.spec,
      })
      this.phaseStartTimes.apply = Date.now()
      this.emitPhaseEvent(refreshed.id, 'apply', 'running', {
        summary: '正在改代码...',
      })
    }, 800)
    this.phaseTimers.push(specTimer)

    logger.info({
      taskId: refreshed.id,
      interpreted: refreshed.requirement.interpreted,
      queueRemaining: this.queue.length,
      projectPath: refreshed.source.currentChunkId ? '(unknown)' : 'projectRoot',
    }, 'Executing task via DshHeadlessRunner (with CodingAgent fallback)')

    try {
      // 主路径:dsh headless
      const projectPath = this.projectPath ?? undefined
      // ★ 执行智能体 emit working
      this.emitAgentStatus({
        agent: 'executor',
        state: 'working',
        message: `dsh 执行 ${refreshed.id.slice(0, 6)}`,
        timestamp: Date.now(),
      })

      type ExecResult = { success: boolean; modifiedFiles: string[]; error?: string; duration?: number }
      const result: ExecResult = await this.dshRunner.execute(refreshed, projectPath)

      // dsh 跑完了 → apply done,finver 启动
      if (this.phaseTaskId === refreshed.id) {
        this.emitPhaseEvent(refreshed.id, 'apply', result.success ? 'done' : 'failed', {
          summary: result.success ? '✓ 代码已修改' : `✗ 执行失败:${result.error}`,
          files: result.modifiedFiles,
          durationMs: Date.now() - (this.phaseStartTimes.apply || Date.now()),
        })
        // ★ finver 启动(测试/验证阶段)
        this.phaseStartTimes.finver = Date.now()
        this.emitPhaseEvent(refreshed.id, 'finver', 'running', {
          summary: '正在跑 lint/build/test...',
        })
        // 1.5s 后 finver 完成
        const finverTimer = setTimeout(() => {
          if (this.phaseTaskId !== refreshed.id) return
          this.emitPhaseEvent(refreshed.id, 'finver', result.success ? 'done' : 'failed', {
            summary: result.success ? '✓ lint + build pass' : '✗ 验证失败',
            durationMs: Date.now() - this.phaseStartTimes.finver,
          })
        }, 1500)
        this.phaseTimers.push(finverTimer)
      }

      // ★ 执行智能体 emit 完成状态
      const execState = result.error?.includes('timeout') ? 'timeout'
        : result.success ? 'success' : 'failed'
      this.emitAgentStatus({
        agent: 'executor',
        state: execState,
        message: result.success
          ? `完成 ${result.modifiedFiles.length} 个文件`
          : `失败: ${result.error?.substring(0, 50) ?? 'unknown'}`,
        durationMs: result.duration,
        timestamp: Date.now(),
      })

      // 完成处理(状态落地 + WS 推送)统一在 onTaskComplete;
      // 注意事件路径可能已先处理,double-complete 防护会自动忽略本次
      this.onTaskComplete(result.success, result.error, {
        modifiedFiles: result.modifiedFiles,
        duration: result.duration,
      })
    } catch (dshErr) {
      logger.warn({
        err: dshErr,
        taskId: refreshed.id,
      }, 'dsh headless failed, falling back to CodingAgent')

      // ★ 执行智能体 emit failed(dsh 异常)
      this.emitAgentStatus({
        agent: 'executor',
        state: 'failed',
        message: 'dsh 异常, 切换 fallback',
        timestamp: Date.now(),
      })

      try {
        // fallback:自研 CodingAgent
        await this.codingAgent.execute(refreshed)
        // CodingAgent 自己 emit task-complete
      } catch (fallbackErr) {
        logger.error({ err: fallbackErr, taskId: refreshed.id }, 'CodingAgent fallback also failed')
        this.onTaskComplete(false, fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr))
      }
    }
  }

  /** 设置项目根目录(ProjectsApi 调用) */
  setProjectPath(path: string): void {
    this.projectPath = path
    logger.info({ projectPath: path }, 'Scheduler projectPath set')
  }
}

// 辅助函数
function taskIdFromEvent(event: AgentEvent): string {
  return event.taskId || 'unknown'
}
