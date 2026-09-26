/**
 * 判断引擎 - 整合规则 + LLM + 状态机 + 调度器
 *
 * 主流程:
 *   ASR chunk 进来
 *     → 滑动窗口累积
 *     → 节流(每 N 个 chunk 触发一次)
 *     → 规则引擎分类(快速)
 *     → LLM 辅助理解(模糊时)
 *     → 创建/更新 Task
 *     → 状态机推进
 *     → 调度器决策执行
 *
 * Task fields are validated at construction; in-place narrowing after a guard
 * is too verbose here, so we suppress a small cluster of optional-chain /
 * redundant-assertion diagnostics.
 */
/* eslint-disable typescript/no-unnecessary-condition,
   typescript/no-unnecessary-type-assertion,
   typescript/no-unsafe-assignment,
   typescript/use-unknown-in-catch-callback-variable,
   typescript/no-confusing-void-expression,
   typescript/no-floating-promises,
   typescript/require-await */
import { logger } from '../logger.js'
import { RuleEngine } from './rule-engine.js'
import { LlmHelper } from './llm-helper.js'
import { TaskQueue } from './task-queue.js'
import { TriggerEngine } from './trigger-engine.js'
import { Scheduler } from './scheduler.js'
import { DecisionStatsService } from './decision-stats.js'
import { FeasibilityEvaluator, isLlmFeasible } from './feasibility-evaluator.js'
import type { CodingAgent } from '../coding-agent/coding-agent.js'
import type { DshHeadlessRunner } from '../dsh-headless-runner/dsh-headless-runner.js'
import type { CodeMap } from '../types/task.js'
import type { AsrChunk, JudgmentEvent } from '../types/task.js'

export interface JudgmentEngineOptions {
  /** 每 N 个 chunk 触发一次完整判断 */
  chunkBatchSize: number
  /**
   * 滑动窗口大小(毫秒),LLM 看到的上下文时间跨度。
   * 默认 60s:容纳一次完整会议回合(提议→讨论→决定)。
   * 扩到 60s 解决了 30s 时代"老板说了上半句被切到下一窗口",LLM 看不到提议过程的痛点。
   */
  windowMs: number
}

export type JudgmentEventListener = (event: JudgmentEvent) => void

/** 执行层 agent(CodingAgent / DshHeadlessRunner)的最小接口 */
interface AgentLike {
  // 宽松签名:兼容 EventEmitter(其 listener 参数为 any[])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): unknown
}

/**
 * 待判断窗口 —— 比单纯 chunks[] 多保留"未完成发言"信息
 *
 * 设计动机:
 *   - 之前的 AsrChunk[] 单一窗口无法表达"这条 chunk 是被截断的,等补全"
 *   - 现在分两段:
 *       chunks:              已经成型的句子(要被 LLM 处理)
 *       pendingIncomplete:   启发式/LLM 判定的截断发言(等后续补全)
 *   - judge 时把 chunks + pendingIncomplete 一起给 LLM,
 *     LLM 可以输出 isIncomplete=true 把对应 chunk 放回 pendingIncomplete
 */
interface PendingWindow {
  /** 已经成型的句子(要被 LLM 处理的) */
  chunks: AsrChunk[]
  /** 启发式/LLM 发现的截断发言,等后续补全(不进 chunks,避免污染 LLM 输入) */
  pendingIncomplete: AsrChunk[]
  /** 第一条 chunk 进入的时间戳 —— 用于"最长 60s 兜底" */
  firstPushAt: number
  /** 窗口内是否有截断标记(决定 computeWaitMs 用更长等待) */
  hasTruncated: boolean
}

export class JudgmentEngine {
  private chunkCount = 0
  private window: PendingWindow = {
    chunks: [],
    pendingIncomplete: [],
    firstPushAt: 0,
    hasTruncated: false,
  }
  /**
   * 上次 judge 时的窗口内容 digest(由 chunkId+timestamp 拼接算 hash)
   *
   * 用途:judge() 完成后,如果窗口内容和上次完全一样,就不要再 scheduleJudge(死循环防护)
   */
  private lastJudgeDigest: string = ''
  /** 当前正在累积的流式句子(isFinal 时 flush) */
  private sentenceBuffer: { text: string; speaker: string; lastChunkId: string; chunks: AsrChunk[] } = {
    text: '',
    speaker: 'unknown',
    lastChunkId: '',
    chunks: [],
  }
  /** debounce timer:防止 FunASR 2pass 太频繁触发 LLM */
  private judgeDebounceTimer: NodeJS.Timeout | null = null
  private ruleEngine = new RuleEngine()
  private llmHelper: LlmHelper
  private feasibilityEvaluator: FeasibilityEvaluator
  private taskQueue = new TaskQueue()
  private triggerEngine = new TriggerEngine()
  private scheduler!: Scheduler
  private stats!: DecisionStatsService
  private listeners: Set<JudgmentEventListener> = new Set()
  private lastSpeaker: string | null = null

  constructor(
    llmHelper: LlmHelper,
    private codeMap: CodeMap | null = null,
    private options: JudgmentEngineOptions = { chunkBatchSize: 3, windowMs: 60_000 },
  ) {
    this.llmHelper = llmHelper
    // feasibilityEvaluator 初始化时默认 framework,ProjectsApi.select 后会通过 setProjectType 切换
    this.feasibilityEvaluator = new FeasibilityEvaluator(llmHelper, 'framework')
    // ★ 注入状态 emit 回调(让 feasibility 智能体能推送工作状态给前端)
    this.feasibilityEvaluator.setStatusEmitter((data) => {
      this.emitAgentStatus(
        data.agent, data.state, data.message, data.durationMs,
      )
    })
    // stats service 依赖 listeners(emitExternal 转发),稍后 bindCodingAgent 之后再初始化
  }

  /** 切换项目类型(pure-html / framework) */
  setProjectType(projectType: 'pure-html' | 'framework'): void {
    this.feasibilityEvaluator.setProjectType(projectType)
    logger.info({ projectType }, 'JudgmentEngine projectType changed')
  }

  /** 初始化 stats service(必须在 bindCodingAgent 之后,确保 emitExternal 可用) */
  private ensureStats(): void {
    if (this.stats) return
    // 通过 this 的 emitExternal 转发 stats/updated 事件给前端
    this.stats = new DecisionStatsService(
      (event) => { this.emit(event) },
      (event) => { this.emit(event) },
      () => this.taskQueue.getAllSummaries(),
    )
    // 初始化后做一次 rebuild(基于现有 tasks)
    this.stats.rebuildFromTasks()
  }

  /** 设置 CodingAgent + 启动调度器(支持 dshRunner 作为主路径) */
  bindCodingAgent(codingAgent: AgentLike, dshRunner?: AgentLike): void {
    this.scheduler = new Scheduler(this.taskQueue, codingAgent as CodingAgent, this.triggerEngine, dshRunner as DshHeadlessRunner)
    this.scheduler.setEventEmitter(this)
    this.ensureStats()
    // 把 stats 注入给 scheduler(由 scheduler 在执行完成/队列变化时埋点)
    if (this.stats) this.scheduler.setStats(this.stats)
    // ★ 注入 agent/status 回调(让 scheduler 转发执行智能体状态给前端)
    this.scheduler.setAgentStatusCallback((data) => {
      this.emit({
        type: 'agent/status',
        data,
      })
    })

    // 完成事件的统一入口:谁先到谁落状态(onTaskComplete 有 double-complete 防护,
    // 第二次调用自动忽略)。事件路径先到就用事件里的 payload。
    codingAgent.on('task-complete', (success: boolean, payload: { error?: string; modifiedFiles?: string[]; duration?: number }) => {
      this.scheduler.onTaskComplete(success, payload?.error, payload)
    })

    if (dshRunner) {
      dshRunner.on('task-complete', (success: boolean, payload: { error?: string; modifiedFiles?: string[]; duration?: number }) => {
        this.scheduler.onTaskComplete(success, payload?.error, payload)
      })
    }
  }

  /** 提供 LLM 配置给 API 层创建新 CodingAgent */
  getLlmConfig(): { apiKey: string; baseUrl: string; model: string } {
    return this.llmHelper.getConfig()
  }

  /** 转发项目根目录给 Scheduler(ProjectsApi.select 时调用) */
  bindProjectPath(projectPath: string): void {
    this.scheduler?.setProjectPath(projectPath)
  }

  /** 更新 Code Map */
  setCodeMap(codeMap: CodeMap): void {
    this.codeMap = codeMap
  }

  /** 订阅事件 */
  on(listener: JudgmentEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 主入口:接收 ASR chunk —— 自适应窗口版本
   *
   * 改造点:
   *   1. 窗口从 AsrChunk[] 升级成 PendingWindow(chunks + pendingIncomplete)
   *   2. 启发式截断检测:疑似截断的发言进 pendingIncomplete(等补全),不进 chunks
   *   3. 同一 speaker 8s 内的下一句如果完整 → 视为补全,把两边都进 chunks
   *   4. 自适应等待时间:截断时多等、沉默时立刻触发、强制 60s 兜底
   *
   * 实时转写和流式累积逻辑不变 —— 那些只影响前端展示,不影响判断层
   */
  async onAsrChunk(chunk: AsrChunk): Promise<void> {
    logger.info({
      chunkId: chunk.id,
      speaker: chunk.speaker,
      text: chunk.text.substring(0, 40),
      isFinal: chunk.isFinal,
      mode: chunk.mode,
    }, 'onAsrChunk received')

    // 1. 推送给前端(实时转写)
    this.emit({ type: 'asr/chunk', data: chunk })

    // 2. 流式增量(isFinal=false):只累积给前端看,不进判断层
    if (!chunk.isFinal) {
      this.sentenceBuffer = {
        text: this.sentenceBuffer.text
          ? `${this.sentenceBuffer.text} ${chunk.text}`.trim()
          : chunk.text,
        speaker: chunk.speaker,
        lastChunkId: chunk.id,
        chunks: [...this.sentenceBuffer.chunks, chunk],
      }
      return
    }

    // 3. isFinal=true:FunASR 2pass-offline 的 text 是【完整句子】(已含全部增量),
    //    直接用它,丢弃 sentenceBuffer 的拼接(否则内容×2)
    const fullSentence = chunk.text.trim()
    this.sentenceBuffer = { text: '', speaker: chunk.speaker, lastChunkId: '', chunks: [] }
    if (!fullSentence) return

    const finalChunk: AsrChunk = { ...chunk, text: fullSentence }

    // 4. 窗口初始化:第一条进入时记 firstPushAt
    if (this.window.chunks.length === 0 && this.window.pendingIncomplete.length === 0) {
      this.window.firstPushAt = Date.now()
    }

    // 5. 启发式截断检测
    if (this.looksTruncated(fullSentence)) {
      // 标记 pending,等后续补全
      this.window.pendingIncomplete.push(finalChunk)
      this.window.hasTruncated = true
      this.evictWindow()
      logger.info({
        chunkId: finalChunk.id,
        text: fullSentence.substring(0, 40),
      }, 'sentence looks truncated, hold as pending')
      // 调度:截断时多等一会(3s)看会不会接下文
      this.scheduleJudge()
      return
    }

    // 6. 完整句子 → 检查是不是补全了之前的 truncated
    const stillPending: AsrChunk[] = []
    for (const pending of this.window.pendingIncomplete) {
      if (this.couldComplete(pending, finalChunk)) {
        // 视为补全:pending + final 一起进 chunks(让 LLM 看完整版)
        this.window.chunks.push(pending, finalChunk)
      } else {
        stillPending.push(pending)
      }
    }
    this.window.pendingIncomplete = stillPending
    this.window.hasTruncated = stillPending.length > 0

    // 7. 当前这条完整句子入窗口
    this.window.chunks.push(finalChunk)
    this.evictWindow()
    this.chunkCount++

    logger.info({
      fullSentence: fullSentence.substring(0, 80),
      windowCount: this.window.chunks.length,
      pendingCount: this.window.pendingIncomplete.length,
    }, 'sentence completed, schedule adaptive judge')

    // 8. 自适应调度
    this.scheduleJudge()
  }

  /** 清空状态(开始新会议) */
  reset(): void {
    this.chunkCount = 0
    this.window = {
      chunks: [],
      pendingIncomplete: [],
      firstPushAt: 0,
      hasTruncated: false,
    }
    this.lastJudgeDigest = ''
    this.taskQueue.clear()
    this.lastSpeaker = null
    if (this.judgeDebounceTimer) {
      clearTimeout(this.judgeDebounceTimer)
      this.judgeDebounceTimer = null
    }
    // 重置统计(顺序:先清 tasks,再 reset stats,这样 rebuild 能拿到空表)
    this.stats?.reset()
  }

  /** 获取所有 task 摘要(给前端初始化) */
  getInitialState(): { tasks: unknown[]; queue: unknown; current: unknown; stats: unknown } {
    return {
      tasks: this.taskQueue.getAllSummaries(),
      queue: this.scheduler?.getQueueState() ?? { queue: [], current: null },
      current: null,
      // 初始 stats 快照(空会议就是全 0)
      stats: this.stats?.snapshot() ?? null,
    }
  }

  // ===== 私有 =====

  /**
   * 核心判断逻辑(LLM 为主)
   *
   * 一次 judge 处理**整个 ASR 窗口**(60s 内的全部 isf 是 chunk):
   *   1. 推送"窗口摘要"给前端(LLM 思考中)
   *   2. LLM 一次调用,看完整对话上下文,输出多意图(每条 intent 标注 sourceChunkId)
   *   3. LLM 失败的 fallback:用规则引擎(只对窗口中每条 chunk 单独跑)
   *   4. 每个意图 → createFromLlm(处理 4 种关系)
   *   5. 评估每个新 task 的可行性
   *   6. 推进状态机 → 调度
   *
   * 关键改进:从"N 次 LLM(每 chunk)"→"1 次 LLM(整个窗口)",
   * 看到完整对话上下文,理解"老板提议→产品同意→老板再提"的回合关系。
   */
  private async judge(): Promise<void> {
    const recent = this.getRecentFinalChunks()
    logger.info({
      recentCount: recent.length,
      chunkCount: this.window.chunks.length,
      pendingCount: this.window.pendingIncomplete.length,
    }, 'judge() called')

    if (recent.length === 0) return

    // ★ 自适应窗口:只清空"已处理的 chunks",保留 pendingIncomplete 等补全
    // (本批 chunks 都已在 getRecentFinalChunks() 里取出来,后续不会再用)
    this.window.chunks = []
    this.window.firstPushAt = 0
    // hasTruncated 在后面根据"新增的 incomplete 标记"重新设置

    // 把【全部任务列表】给 LLM(去重判断需要看到所有已提取任务,不只最近5个)
    const recentTasks = this.taskQueue.getAllTasksForLlm()

    // ★ 跨窗口的最近 chunks(指代消解用,不产生 task)
    const contextChunks = this.getContextChunksForLlm(5)

    // 推送"窗口摘要"给前端(让用户知道 LLM 在处理哪些发言)
    this.emit({
      type: 'judgment/reasoning',
      data: {
        stage: 'input',
        chunkIds: recent.map(c => c.id),
        chunks: recent.map(c => ({
          chunkId: c.id,
          speaker: c.speaker,
          text: c.text,
          timestamp: c.timestamp,
        })),
        recentTasksCount: recentTasks.length,
        windowSpanMs: recent.length > 0
          ? recent[recent.length - 1].timestamp - recent[0].timestamp
          : 0,
      },
    })

    // ★ 意图提取智能体 emit working
    const intentStart = Date.now()
    this.emitAgentStatus('intent', 'working', `处理 ${recent.length} 句 + ${contextChunks.length} 上下文`)

    // 一次 LLM 调用,看整个窗口 + 跨窗口上下文(指代消解)
    const llmRawResult = await this.llmHelper.understand(recent, recentTasks, contextChunks)

    // ★ 意图提取智能体 emit 完成状态
    const intentDuration = Date.now() - intentStart
    if (llmRawResult !== null && llmRawResult.intents.length > 0) {
      this.emitAgentStatus('intent', 'success', `提取 ${llmRawResult.intents.length} 个意图`, intentDuration)
    } else if (llmRawResult === null) {
      this.emitAgentStatus('intent', 'failed', 'LLM 调用失败', intentDuration)
    } else {
      // LLM 返回空 intents(纯 chitchat)
      this.emitAgentStatus('intent', 'success', '无意图', intentDuration)
    }

    // 兜底成非 null(即使 LLM 完全失败,fallback 也保证有返回)
    type FallbackIntent = ReturnType<JudgmentEngine['fallbackRuleExtract']>['intents'][number]
    /** 整个 judge 流程用的统一 intent 形状(LLM 输出 + fallback,字段对齐 LlmIntentOutput) */
    type JudgeIntent = FallbackIntent & {
      intent: string  // 放宽,允许 approval/rejection/defer 等
      relationTo: { taskId: string | null; type: string | null } | null
      sourceChunkId: string | null
      isIncomplete?: boolean
    }
    const safeLlmResult: { intents: JudgeIntent[] } =
      (!llmRawResult || llmRawResult.intents.length === 0)
        ? (() => {
          logger.info({ chunkCount: recent.length }, 'LLM failed/unclear, fallback to rules')
          // ★ 规则引擎 fallback 智能体 emit triggered
          this.emitAgentStatus('rule-fallback', 'triggered', `LLM 失败,${recent.length} 句走规则`)
          const fallbackIntents: FallbackIntent[] = []
          for (const c of recent) {
            const r = this.fallbackRuleExtract(c)
            fallbackIntents.push(...r.intents)
          }
          return { intents: fallbackIntents }
        })()
        : (llmRawResult as unknown as { intents: JudgeIntent[] })

    // ★ 截断统计:把 LLM 标记为 incomplete 的 chunk 记下来(用于后续回写到 pendingIncomplete)
    const incompleteChunkIds = new Set<string>()
    for (const intent of safeLlmResult.intents) {
      if (intent.isIncomplete === true && intent.sourceChunkId) {
        incompleteChunkIds.add(intent.sourceChunkId)
      }
    }

    // ★ 埋点:LLM 意图提取(只统计 LLM 真的输出过的意图,fallback 也算)
    // 用首个被引用的 chunk 作为主 chunkId(用于关联原话);多 chunk 场景下 intent 自己也带 sourceChunkId
    const primaryChunkId = recent[0]?.id ?? 'unknown'
    const primarySpeaker = recent[0]?.speaker ?? 'unknown'
    const primaryRawText = recent.map(c => c.text).join(' / ')
    this.stats?.recordIntents(
      primaryChunkId,
      primaryRawText,
      safeLlmResult.intents.map(i => ({
        intent: i.intent,
        rawText: i.rawText,
        interpreted: i.interpreted,
        target: i.target,
        confidence: i.confidence,
        relationTo: i.relationTo,
        reasoning: i.reasoning,
      })),
      primarySpeaker,
    )

    // 推送 LLM 思考过程(给前端展示)—— 现在是整窗口一次的 judgment
    this.emit({
      type: 'judgment/reasoning',
      data: {
        stage: 'llm',
        chunkIds: recent.map(c => c.id),
        intentCount: safeLlmResult.intents.length,
        intents: safeLlmResult.intents.map(i => ({
          intent: i.intent,
          rawText: i.rawText,
          interpreted: i.interpreted,
          target: i.target,
          confidence: i.confidence,
          relationTo: i.relationTo,
          sourceChunkId: i.sourceChunkId,
          reasoning: i.reasoning,
        })),
      },
    })

    // 3. 处理每个意图
    for (const intent of safeLlmResult.intents) {
      // sourceChunkId 用于关联具体原话;fallback 时用首个 chunk
      const sourceChunk = intent.sourceChunkId
        ? (recent.find(c => c.id === intent.sourceChunkId) ?? recent[0])
        : recent[0]
      const sourceChunkId = sourceChunk?.id ?? primaryChunkId
      const sourceSpeaker = sourceChunk?.speaker ?? primarySpeaker

      // ★ 截断处理:LLM 标了 isIncomplete → 把对应 chunk 放回 pendingIncomplete,跳过建 task
      if (intent.isIncomplete === true) {
        this.emit({
          type: 'judgment/reasoning',
          data: {
            stage: 'incomplete',
            chunkId: sourceChunkId,
            rawText: intent.rawText,
            note: intent.reasoning || 'LLM 判定不完整,等待后续补充',
          },
        })
        continue
      }

      const result = this.taskQueue.createFromLlm(sourceChunk, intent as Parameters<TaskQueue['createFromLlm']>[1])

      if (!result) {
        // 拒绝:target 缺失 / intent 无效 / rejects 处理
        this.emit({
          type: 'judgment/reasoning',
          data: {
            stage: 'rejected',
            chunkId: sourceChunkId,
            reason: !intent.target ? 'target 缺失' : intent.intent === 'unclear' ? '意图不明确' : '关系处理',
            rawText: intent.rawText,
          },
        })
        continue
      }

      if (result.handledAsReject) {
        // ★ 埋点:用户驳回已存在的 task(rejects 关系)
        this.stats?.recordTaskRejectedByUser({
          taskId: result.task.id,
          chunkId: sourceChunkId,
          speaker: sourceSpeaker,
          rawText: intent.rawText,
          reasoning: intent.reasoning,
          fromStatus: result.task.status === 'rejected' ? 'confirmed' : result.task.status,
        })

        // 驳回已有 task,不创建新
        this.emit({
          type: 'task/rejected',
          data: {
            id: result.task.id,
            reason: intent.reasoning,
          },
        })
        this.emit({
          type: 'judgment/reasoning',
          data: {
            stage: 'decision',
            chunkId: sourceChunkId,
            action: 'rejected-existing',
            taskId: result.task.id,
            reasoning: intent.reasoning,
          },
        })
        continue
      }

      const task = result.task
      // 提前取一次 intent 字符串字面量,后面多处比较用
      const intentName: string = intent.intent

      // approval/defer:不创建新 task,只更新现有
      if (!result.isNew) {
        // 区分 approval(LLM intent=approval) vs 去重合并(精确/语义 target 匹配)
        const isApproval = intentName === 'approval'
        if (isApproval) {
          // ★ 埋点:用户确认
          this.stats?.recordTaskApproved({
            taskId: task.id,
            chunkId: sourceChunkId,
            speaker: sourceSpeaker,
            rawText: intent.rawText,
            reasoning: intent.reasoning,
            mentionCount: task.source.mentionCount,
          })
        } else {
          // ★ 埋点:去重合并(已有 task 被再次提及)
          this.stats?.recordTaskDeduped({
            taskId: task.id,
            chunkId: sourceChunkId,
            speaker: sourceSpeaker,
            rawText: intent.rawText,
            reason: 'semantic', // createFromLlm 命中精确/语义去重,都到这里
            existingMentionCount: task.source.mentionCount - 1,
            reasoning: intent.reasoning,
          })
        }

        this.emit({
          type: 'judgment/reasoning',
          data: {
            stage: 'decision',
            chunkId: sourceChunkId,
            action: 'merged',
            taskId: task.id,
            reasoning: intent.reasoning,
            relationTo: intent.relationTo,
          },
        })
        continue
      }

      // 区分 defer(LLM intent=defer) vs 真新建
      if (intentName === 'defer') {
        // ★ 埋点:用户暂存(注意:handleDefer 已经改了 status=deferred,这里只需埋点)
        this.stats?.recordTaskDeferred({
          taskId: task.id,
          chunkId: sourceChunkId,
          speaker: sourceSpeaker,
          rawText: intent.rawText,
          reasoning: intent.reasoning,
          fromStatus: 'confirmed', // handleDefer 通常是把 confirmed 转 deferred
        })
        continue
      }

      // 处理 supersede 关系:先对被取代的旧 task 埋点,再埋新 task
      if (result.supersededOld) {
        this.stats?.recordTaskSuperseded({
          taskId: result.supersededOld.id, // 旧 task 的 id
          newTaskId: task.id,
          chunkId: sourceChunkId,
          speaker: sourceSpeaker,
          rawText: intent.rawText,
          reasoning: intent.reasoning,
          fromStatus: result.supersededOld.prevStatus,
        })
      }

      // ★ 埋点:真新建 task(detected 状态)
      this.stats?.recordTaskCreated({
        taskId: task.id,
        chunkId: sourceChunkId,
        speaker: sourceSpeaker,
        rawText: intent.rawText,
        intent: intent.intent,
        target: intent.target,
        confidence: intent.confidence,
        reasoning: intent.reasoning,
      })

      // 推送决策
      this.emit({
        type: 'judgment/reasoning',
        data: {
          stage: 'decision',
          chunkId: sourceChunkId,
          action: 'created',
          taskId: task.id,
          intent: task.requirement.intent,
          target: task.llm?.target,
          confidence: task.llm?.confidence,
          sourceChunkId,
          reasoning: intent.reasoning,
          relationTo: intent.relationTo,
        },
      })

      const summary = this.taskQueue.getSummary(task.id)
      if (summary) {
        this.emit({ type: 'task/created', data: summary })
      }

      // 4. 评估可行性(setStatus 之前已经 transitionStatus 同步)
      this.taskQueue.setStatus(task.id, 'analyzing', '正在评估可行性')
      this.emit({
        type: 'task/analyzing',
        data: { id: task.id, reasoning: '等待可行性评估' },
      })
      // fire-and-forget:LLM 可行性评估是异步的,调用方不等结果
      void this.evaluateFeasibility(task.id, sourceChunk, intent.rawText).catch(err =>
        logger.error({ err, taskId: task.id }, 'evaluateFeasibility failed'),
      )
    }

    // 没有匹配到任何意图 → unclear
    if (safeLlmResult.intents.length === 0) {
      this.emit({
        type: 'judgment/reasoning',
        data: {
          stage: 'unclear',
          chunkIds: recent.map(c => c.id),
          text: recent.map(c => c.text).join(' / '),
          note: 'LLM 和规则都没识别出明确意图,可能是不清晰的发言',
        },
      })
    }

    // ★ 自适应窗口:把 LLM 标记 incomplete 的 chunk 放回 pendingIncomplete,等补全
    for (const chunkId of incompleteChunkIds) {
      const chunk = recent.find(c => c.id === chunkId)
      if (chunk && !this.window.pendingIncomplete.find(p => p.id === chunk.id)) {
        this.window.pendingIncomplete.push(chunk)
      }
    }

    // ★ 死循环防护:judge() 完成后,如果窗口内容没变,不再次 scheduleJudge
    // (否则 LLM 反复把同一个 chunk 标 incomplete → 死循环)
    const currentDigest = this.computeWindowDigest()
    const hasNewContent = currentDigest !== this.lastJudgeDigest
    if (this.window.pendingIncomplete.length > 0 && hasNewContent) {
      this.window.firstPushAt = Date.now()
      this.window.hasTruncated = true
      this.scheduleJudge()
    } else if (this.window.pendingIncomplete.length > 0) {
      logger.debug({
        pendingCount: this.window.pendingIncomplete.length,
        digest: currentDigest.slice(0, 80),
      }, 'pending unchanged, skip reschedule (anti-loop)')
    }
    this.lastJudgeDigest = currentDigest

    this.checkTransitions()
    this.broadcastQueueState()
    // 同步调度队列长度(stats 用)
    this.stats?.setQueuedCount(this.scheduler?.getQueueState().queue.length ?? 0)
  }

  /**
   * 计算当前窗口的"内容 digest"(用于检测是否有新内容进入)
   *
   * 内容 = chunks + pendingIncomplete 各自的 id+timestamp 拼接后排序
   * 只要有新 chunk 进入或 pending 变化,digest 就会变
   */
  private computeWindowDigest(): string {
    const all = [
      ...this.window.chunks.map(c => `c:${c.id}:${c.timestamp}`),
      ...this.window.pendingIncomplete.map(c => `p:${c.id}:${c.timestamp}`),
    ]
    return all.sort().join('|')
  }

  /**
   * 降级方案:用规则引擎(LLM 不可用时)
   * 输出格式尽量贴近 LLM 输出
   */
  private fallbackRuleExtract(chunk: AsrChunk): {
    intents: Array<{
      intent: 'add-feature' | 'modify-feature' | 'delete-feature' | 'fix-bug' | 'data-change' | 'unclear'
      rawText: string
      interpreted: string
      target: string | null
      confidence: number
      relationTo: null
      sourceChunkId: string
      reasoning: string
    }>
  } {
    const ruleResult = this.ruleEngine.classify(chunk.text)
    const intents: Array<{
      intent: 'add-feature' | 'modify-feature' | 'delete-feature' | 'fix-bug' | 'data-change' | 'unclear'
      rawText: string
      interpreted: string
      target: string | null
      confidence: number
      relationTo: null
      sourceChunkId: string
      reasoning: string
    }> = []

    if (ruleResult.signals.length > 0) {
      // 提取 target(启发式:从信号中提取名词)
      const target = this.extractTarget(ruleResult.signals.map(s => s.text).join(' '))

      const mappedIntent = ruleResult.intent === 'unclear' || ruleResult.intent === 'discussion'
        ? 'unclear'
        : (ruleResult.intent === 'style-change' ? 'modify-feature' : ruleResult.intent)
      intents.push({
        intent: mappedIntent,
        rawText: chunk.text,
        interpreted: ruleResult.signals.map(s => s.text).join('; '),
        target,
        confidence: 0.7,
        relationTo: null,
        sourceChunkId: chunk.id,
        reasoning: `规则匹配:${ruleResult.signals.map(s => s.matchedPattern).join(', ')}`,
      })
    }

    return { intents }
  }

  /** 启发式提取 target(从信号文本里找名词短语) */
  private extractTarget(text: string): string | null {
    // 简单实现:提取 2-6 字的名词短语
    const candidates: string[] = []
    for (let len = 2; len <= 6; len++) {
      for (let i = 0; i <= text.length - len; i++) {
        const word = text.substring(i, i + len)
        if (/[一-龥]{2,}/.test(word) && !/^(这个|那个|一下|一种|一些)/.test(word)) {
          candidates.push(word)
        }
      }
    }
    return candidates.length > 0 ? candidates[0] : null
  }

  private async evaluateFeasibility(taskId: string, sourceChunk?: AsrChunk, rawText?: string): Promise<void> {
    const task = this.taskQueue.get(taskId)
    if (!task) return

    // ★ 同步 stats:detected → analyzing(在 setStatus('analyzing') 之前)
    if (task.status === 'detected' || task.status === 'deferred') {
      this.stats?.transitionStatus(taskId, task.status, 'analyzing')
    }

    // ★ LLM 可行性评估(异步)
    // 失败 → FeasibilityEvaluator 内 fallback 到纯规则
    let feasibility: import('../types/task.js').Feasibility
    try {
      feasibility = await this.feasibilityEvaluator.evaluate(task, this.codeMap)
    } catch (err) {
      logger.error({ err, taskId }, 'feasibility evaluator threw')
      // 极端兜底:不可行
      feasibility = {
        technical: 'unknown',
        workload: 'medium',
        riskLevel: 'medium',
        inWhitelist: false,
        codeMapRefs: [],
        reasoning: '评估过程异常,保守判定不可行',
      }
    }

    this.taskQueue.setFeasibility(taskId, feasibility)

    this.emit({
      type: 'judgment/feasibility',
      data: { taskId, ...feasibility },
    })

    // ★ 组合判定(LLM 可行性 → 决策层数字)
    const isFeasible = isLlmFeasible(feasibility)

    if (isFeasible) {
      this.taskQueue.setStatus(taskId, 'confirmed', '可行性通过', '准备执行')
      this.emit({
        type: 'task/confirmed',
        data: { id: taskId, reason: feasibility.reasoning },
      })

      // ★ 埋点:可行性评估通过
      this.stats?.recordFeasibilityEvaluated({
        taskId,
        chunkId: sourceChunk?.id ?? null,
        speaker: sourceChunk?.speaker ?? null,
        rawText: rawText ?? null,
        fromStatus: 'analyzing',
        feasibility,
        passed: true,
        nextStatus: 'confirmed',
        reasoning: feasibility.reasoning,
      })

      // 自主补全(可选)
      this.tryAutoComplete(taskId)

      // 进入调度器
      const confirmedTask = this.taskQueue.get(taskId)
      if (confirmedTask) this.scheduler.onTaskConfirmed(confirmedTask)
    } else {
      this.taskQueue.setStatus(taskId, 'rejected', feasibility.reasoning)
      this.emit({
        type: 'task/rejected',
        data: { id: taskId, reason: feasibility.reasoning },
      })

      // ★ 埋点:可行性评估拒绝
      this.stats?.recordFeasibilityEvaluated({
        taskId,
        chunkId: sourceChunk?.id ?? null,
        speaker: sourceChunk?.speaker ?? null,
        rawText: rawText ?? null,
        fromStatus: 'analyzing',
        feasibility,
        passed: false,
        nextStatus: 'rejected',
        reasoning: feasibility.reasoning,
      })
    }
  }

  private async tryAutoComplete(taskId: string): Promise<void> {
    const task = this.taskQueue.get(taskId)
    if (!task) return

    // 只对 add-feature / modify-feature 做补全
    if (!['add-feature', 'modify-feature'].includes(task.requirement.intent)) return

    const completions: Array<{ field: string; value: string; reason: string; source: 'auto-filled' }> = []

    // 老板说"加个筛选",补全具体字段
    if (/筛选/.test(task.requirement.interpreted)) {
      const fields = ['行业', '状态', '创建时间']
      for (const f of fields) {
        completions.push({
          field: `筛选条件:${f}`,
          value: '包含',
          reason: `基于客户管理场景,${f}是常见筛选维度`,
          source: 'auto-filled',
        })
      }
    }

    // 老板说"加个导出"
    if (/导出/.test(task.requirement.interpreted)) {
      completions.push({
        field: '导出格式',
        value: 'CSV',
        reason: '客户数据常用 CSV 格式',
        source: 'auto-filled',
      })
    }

    // 老板说"加个字段"
    if (/字段/.test(task.requirement.interpreted)) {
      completions.push({
        field: '字段类型',
        value: 'string(可空)',
        reason: '通用字段,后续可调整',
        source: 'auto-filled',
      })
    }

    if (completions.length > 0) {
      this.taskQueue.addCompletions(taskId, completions)
      this.emit({
        type: 'judgment/completion',
        data: {
          taskId,
          completions: completions.map(c => ({
            field: c.field,
            value: c.value,
            reason: c.reason,
            source: 'auto-filled' as const,
          })),
        },
      })
    }
  }

  private checkTransitions(): void {
    const activeTasks = this.taskQueue.getActiveTasks()
    for (const task of activeTasks) {
      // mentionCount >= 2 自动提升
      if (task.status === 'detected' && task.source.mentionCount >= 2) {
        this.stats?.transitionStatus(task.id, 'detected', 'analyzing')
        this.taskQueue.setStatus(task.id, 'analyzing', '多人多次提及,开始评估')
        this.emit({
          type: 'task/analyzing',
          data: { id: task.id, reasoning: '多次提及,提升评估优先级' },
        })
        // 自动提升时 chunk 不一定是当前 judge 的 chunk,用最后一次提及的
        const lastChunkId = task.source.asrChunkIds[task.source.asrChunkIds.length - 1]
        const lastRawText = task.source.transcript[task.source.transcript.length - 1]?.text
        // 用 sourceChunk 占位(只为 stats log 关联上)
        const placeholder: AsrChunk = {
          id: lastChunkId || 'auto-promote',
          text: lastRawText || task.requirement.raw,
          speaker: task.source.speakers[task.source.speakers.length - 1] || 'unknown',
          timestamp: task.source.lastSeenAt,
          isFinal: true,
          mode: 'offline',
        }
        // fire-and-forget
        void this.evaluateFeasibility(task.id, placeholder, lastRawText).catch(err =>
          logger.error({ err, taskId: task.id }, 'evaluateFeasibility failed'),
        )
      }
    }
  }

  private handleRejection(chunk: AsrChunk): void {
    // 已废弃:拒绝判定交给 LLM(通过 relationTo.rejects)
    // 保留方法避免编译错误,但不再调用
    logger.warn({ chunkId: chunk.id }, 'handleRejection called but deprecated')
  }

  // ====== 自适应窗口:启发式检测 / 动态等待 / 智能调度 ======

  /**
   * 启发式截断检测:这段发言是不是被截断了?
   * 返回 true → 不进 chunks,进 pendingIncomplete,延长等待
   */
  private looksTruncated(text: string): boolean {
    const s = text.trim()
    if (!s) return false

    // 1. 以终止标点结尾 → 大概率完整
    if (/[。！？]$/.test(s)) return false

    // 2. 长度过短 + 没有明确动作词 → 大概率没说完
    if (s.length < 6 && !/(完成|结束|搞定|好了|可以|同意|确认)/.test(s)) return true

    // 3. 以语气词/停顿词结尾 → 大概率被截断
    // (这些词在中文里几乎不可能作为一句话的合法结尾)
    if (/(嗯|啊|呃|哦|那个|这个|就是|吧|呢)$/.test(s)) return true

    // 4. 以省略号结尾 → 一定截断
    if (/[…]+$/.test(s)) return true

    // 5. 含"等下/待会/我想想/回头"等表态但没说完 → 截断
    if (/(等下|待会|我想想|回头|下次|等等|稍后)/.test(s)) return true

    return false
  }

  /**
   * 检测"新发言是不是补全了之前的截断句"
   * 例: pending="嗯那个客户列表", new="需要加个筛选" → 补全
   *
   * 启发式:同 speaker + 间隔 < 8s + 新句以终止标点结尾
   */
  private couldComplete(pending: AsrChunk, newChunk: AsrChunk): boolean {
    // 不同人说话不算补全
    if (pending.speaker !== newChunk.speaker) return false
    // 间隔太久不算(超过 8s 通常是新发言)
    if (newChunk.timestamp - pending.timestamp > 8000) return false
    // 新发言必须以终止标点结尾(才"看起来像"补全完成的句子)
    if (!/[。！？]$/.test(newChunk.text.trim())) return false
    return true
  }

  /** 窗口内最近一条 chunk 的时间戳(chunks + pendingIncomplete 都算) */
  private lastActivityAt(): number {
    const all = [...this.window.chunks, ...this.window.pendingIncomplete]
    if (all.length === 0) return Date.now()
    return Math.max(...all.map(c => c.timestamp))
  }

  /**
   * 根据窗口状态动态算"还要等多久才能 judge"
   * 返回 0 表示立即触发
   *
   * 规则:
   *   1. 窗口里有截断标记 → 至少等 3s 看会不会补全(给到 3s 总等待)
   *   2. 最后一条 chunk 还在 1.5s 内(对方可能还在说)→ 等满 1.5s
   *   3. 已经沉默 2s+ → 立刻触发(进入 LLM 思考)
   *   4. 默认: 1.5s(给一点缓冲)
   */
  private computeWaitMs(): number {
    if (this.window.chunks.length === 0 && this.window.pendingIncomplete.length === 0) {
      return 0  // 没东西,别等
    }

    const elapsed = Date.now() - this.window.firstPushAt
    const lastActivity = this.lastActivityAt()
    const sinceLast = Date.now() - lastActivity

    // 规则 1: 检测到截断 → 至少等 3s 看是否补全(给到 3s 总等待)
    if (this.window.hasTruncated) {
      return Math.max(3000 - elapsed, 1000)
    }

    // 规则 2: 最后一条 chunk 还在 1.5s 内(对方可能还在说)→ 等满 1.5s
    if (sinceLast < 1500) return 1500 - sinceLast

    // 规则 3: 已经沉默 2s+ → 立刻触发
    if (sinceLast >= 2000) return 0

    // 默认: 1.5s(给一点缓冲)
    return 1500
  }

  /**
   * 替换原来的 setTimeout 1200ms 逻辑
   * 每次有 chunk 进入都调用,会"重置"等待时间
   *
   * 兜底:从 firstPushAt 起 60s 内必须触发,避免极端情况一直攒着
   */
  private scheduleJudge(): void {
    if (this.judgeDebounceTimer) {
      clearTimeout(this.judgeDebounceTimer)
      this.judgeDebounceTimer = null
    }

    const waitMs = this.computeWaitMs()

    // 兜底:从 firstPushAt 起 60s 内必须触发
    const elapsed = Date.now() - this.window.firstPushAt
    const hardCap = Math.max(500, 60_000 - elapsed)
    const delay = Math.min(waitMs, hardCap)

    if (delay === 0) {
      setImmediate(() => this.runJudgeSafely())
    } else {
      this.judgeDebounceTimer = setTimeout(() => {
        this.judgeDebounceTimer = null
        this.runJudgeSafely()
      }, delay)
    }
  }

  private runJudgeSafely(): void {
    this.judge().catch((err: unknown) => {
      logger.error({
        err: String(err),
        stack: (err as Error)?.stack,
      }, 'judge() threw')
    })
  }

  private evictWindow(): void {
    const cutoff = Date.now() - this.options.windowMs
    this.window.chunks = this.window.chunks.filter(c => c.timestamp >= cutoff)
    this.window.pendingIncomplete = this.window.pendingIncomplete.filter(c => c.timestamp >= cutoff)
    this.window.hasTruncated = this.window.pendingIncomplete.length > 0
  }

  /**
   * 取要送进 LLM 的 chunks —— 把 pendingIncomplete 也一起带上
   * 让 LLM 自己评估是否截断(输出 isIncomplete=true)
   */
  private getRecentFinalChunks(): AsrChunk[] {
    const all = [...this.window.chunks, ...this.window.pendingIncomplete]
    return all.filter(c => c.isFinal || c.mode === 'offline')
  }

  /**
   * 取跨窗口的最近 N 个 final chunks(指代消解用)
   *
   * 这些 chunks 不在当前窗口里,但 LLM 需要它们来解析
   * "这块/那个/刚才说的" 等指代词的对象。
   *
   * 实现:从 taskQueue.getAllTranscriptSegments() 取最近 N 个,
   *      排除当前窗口的 chunks(避免重复)。
   */
  private getContextChunksForLlm(n: number): AsrChunk[] {
    // 当前窗口里的 chunk id 集合(用于去重)
    const currentIds = new Set<string>([
      ...this.window.chunks.map(c => c.id),
      ...this.window.pendingIncomplete.map(c => c.id),
    ])

    // 从所有 transcript segments 里过滤掉当前窗口的,取最近 N 个
    const allSegments = this.taskQueue.getAllTranscriptSegments()
    return allSegments
      .filter(s => !currentIds.has(s.chunkId))
      .slice(-n)
      .map<AsrChunk>(s => ({
        id: s.chunkId,
        text: s.text,
        speaker: s.speaker,
        timestamp: s.at,
        isFinal: true,
        mode: 'offline',
      }))
  }

  private synthesizeInterpretation(rule: { signals: Array<{ text: string }> }): string {
    // 简化:直接把原文作为解读
    return rule.signals.map(s => s.text).join('; ')
  }

  private findCodeMapRefs(text: string): string[] {
    if (!this.codeMap) return []
    const refs: string[] = []

    // 简单的关键词匹配
    const keywords = text.toLowerCase().split(/\s+/).filter(w => w.length > 2)
    for (const node of this.codeMap.components) {
      const nodeName = node.path.toLowerCase()
      for (const kw of keywords) {
        if (nodeName.includes(kw)) {
          refs.push(node.path)
          break
        }
      }
    }

    return refs.slice(0, 5)
  }

  private emit(event: JudgmentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (err) {
        logger.error({ err }, 'Listener error')
      }
    }
  }

  /**
   * 推送智能体工作状态事件(给前端 AgentStatusRow 组件展示)
   *
   * 各智能体在 lifecycle 关键节点调用:
   *   emitAgentStatus('intent', 'working', '提取 N 句意图')
   *   emitAgentStatus('intent', 'success', '提取 M 个需求', durationMs)
   *   emitAgentStatus('intent', 'failed', 'LLM 错误信息')
   */
  private emitAgentStatus(
    agent: import('../types/task.js').AgentType,
    state: import('../types/task.js').AgentState,
    message?: string,
    durationMs?: number,
  ): void {
    this.emit({
      type: 'agent/status',
      data: {
        agent,
        state,
        message,
        durationMs,
        timestamp: Date.now(),
      },
    })
  }

  /** 公开 emit(给 Scheduler 等外部模块转发 CodingAgent 事件用) */
  public emitExternal(event: JudgmentEvent): void {
    this.emit(event)
  }

  private broadcastQueueState(): void {
    if (!this.scheduler) return
    const state = this.scheduler.getQueueState()
    this.emit({ type: 'queue/state', data: state })
  }
}
