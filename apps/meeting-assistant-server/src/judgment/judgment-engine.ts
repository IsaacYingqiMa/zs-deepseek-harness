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
 */
import { logger } from '../logger.js'
import { RuleEngine } from './rule-engine.js'
import { LlmHelper } from './llm-helper.js'
import { TaskQueue } from './task-queue.js'
import { TriggerEngine } from './trigger-engine.js'
import { Scheduler } from './scheduler.js'
import type { CodingAgent } from '../coding-agent/coding-agent.js'
import type { DshHeadlessRunner } from '../dsh-headless-runner/dsh-headless-runner.js'
import type { CodeMap } from '../types/task.js'
import type { AsrChunk, JudgmentEvent } from '../types/task.js'

export interface JudgmentEngineOptions {
  /** 每 N 个 chunk 触发一次完整判断 */
  chunkBatchSize: number
  /** 滑动窗口大小(毫秒) */
  windowMs: number
}

export type JudgmentEventListener = (event: JudgmentEvent) => void

/** 执行层 agent(CodingAgent / DshHeadlessRunner)的最小接口 */
interface AgentLike {
  // 宽松签名:兼容 EventEmitter(其 listener 参数为 any[])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): unknown
}

export class JudgmentEngine {
  private chunkCount = 0
  private window: AsrChunk[] = []
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
  private taskQueue = new TaskQueue()
  private triggerEngine = new TriggerEngine()
  private scheduler!: Scheduler
  private listeners: Set<JudgmentEventListener> = new Set()
  private lastSpeaker: string | null = null

  constructor(
    llmHelper: LlmHelper,
    private codeMap: CodeMap | null = null,
    private options: JudgmentEngineOptions = { chunkBatchSize: 3, windowMs: 30_000 },
  ) {
    this.llmHelper = llmHelper
  }

  /** 设置 CodingAgent + 启动调度器(支持 dshRunner 作为主路径) */
  bindCodingAgent(codingAgent: AgentLike, dshRunner?: AgentLike): void {
    this.scheduler = new Scheduler(this.taskQueue, codingAgent as CodingAgent, this.triggerEngine, dshRunner as DshHeadlessRunner)
    this.scheduler.setEventEmitter(this)

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
   * 主入口:接收 ASR chunk
   *
   * 修复后逻辑:
   *   1. 推送给前端(实时转写)—— 每个 chunk 都推
   *   2. 句子累积:isFinal=false 的 chunk 累积到 sentenceBuffer
   *   3. isFinal=true 时:flush buffer → 触发 judge → 清空窗口
   *   4. chunkCount 只在 isFinal 时 +1(避免流式中间结果频繁触发)
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

    // 空句子跳过
    if (!fullSentence) return

    // 把完整句子加入窗口
    const finalChunk: AsrChunk = {
      ...chunk,
      text: fullSentence,
    }
    this.window.push(finalChunk)
    this.evictWindow()
    this.chunkCount++

    logger.info({
      fullSentence: fullSentence.substring(0, 80),
      windowCount: this.window.length,
    }, 'sentence completed, schedule judge')

    // 4. debounce:FunASR 一句话可能连发多个 offline 结果,延 1200ms 合并
    if (this.judgeDebounceTimer) clearTimeout(this.judgeDebounceTimer)
    this.judgeDebounceTimer = setTimeout(async () => {
      this.judgeDebounceTimer = null
      try {
        await this.judge()
      } catch (err) {
        logger.error({ err: String(err), stack: (err as Error)?.stack }, 'judge() threw')
      }
    }, 1200)
  }

  /** 清空状态(开始新会议) */
  reset(): void {
    this.chunkCount = 0
    this.window = []
    this.taskQueue.clear()
    this.lastSpeaker = null
    if (this.judgeDebounceTimer) {
      clearTimeout(this.judgeDebounceTimer)
      this.judgeDebounceTimer = null
    }
  }

  /** 获取所有 task 摘要(给前端初始化) */
  getInitialState(): { tasks: unknown[]; queue: unknown; current: unknown } {
    return {
      tasks: this.taskQueue.getAllSummaries(),
      queue: this.scheduler?.getQueueState() ?? { queue: [], current: null },
      current: null,
    }
  }

  // ===== 私有 =====

  /**
   * 核心判断逻辑(LLM 为主)
   *
   * 对每个新 chunk:
   *   1. 调用 LLM(接收 chunk + 历史 task,输出多意图)
   *   2. LLM 失败的 fallback:用规则引擎
   *   3. 每个意图 → createFromLlm(完全不去重,处理 4 种关系)
   *   4. 评估每个新 task 的可行性
   *   5. 推进状态机 → 调度
   */
  private async judge(): Promise<void> {
    const recent = this.getRecentFinalChunks()
    logger.info({ recentCount: recent.length, windowCount: this.window.length }, 'judge() called')

    if (recent.length === 0) return

    // 立刻清空 window:本次 judge 只处理这批句子,同一句话绝不二次进 LLM
    this.window = []

    // 把【全部任务列表】给 LLM(去重判断需要看到所有已提取任务,不只最近5个)
    const recentTasks = this.taskQueue.getAllTasksForLlm()

    for (const chunk of recent) {
      // 1. 推送 chunk 给前端(LLM 思考中)
      this.emit({
        type: 'judgment/reasoning',
        data: {
          stage: 'input',
          chunkId: chunk.id,
          text: chunk.text,
          timestamp: chunk.timestamp,
          recentTasksCount: recentTasks.length,
        },
      })

      // 2. LLM 提取意图
      let llmResult = await this.llmHelper.understand(chunk, recentTasks)

      // LLM 失败的 fallback:用规则引擎
      if (!llmResult || llmResult.intents.length === 0) {
        logger.info({ chunkId: chunk.id }, 'LLM failed/unclear, fallback to rules')
        llmResult = this.fallbackRuleExtract(chunk)
      }

      // 推送 LLM 思考过程(给前端展示)
      this.emit({
        type: 'judgment/reasoning',
        data: {
          stage: 'llm',
          chunkId: chunk.id,
          intentCount: llmResult.intents.length,
          intents: llmResult.intents.map(i => ({
            intent: i.intent,
            rawText: i.rawText,
            interpreted: i.interpreted,
            target: i.target,
            confidence: i.confidence,
            relationTo: i.relationTo,
            reasoning: i.reasoning,
          })),
        },
      })

      // 3. 处理每个意图
      for (const intent of llmResult.intents) {
        const result = this.taskQueue.createFromLlm(chunk, intent as Parameters<TaskQueue['createFromLlm']>[1])

        if (!result) {
          // 拒绝:target 缺失 / intent 无效 / rejects 处理
          this.emit({
            type: 'judgment/reasoning',
            data: {
              stage: 'rejected',
              chunkId: chunk.id,
              reason: !intent.target ? 'target 缺失' : intent.intent === 'unclear' ? '意图不明确' : '关系处理',
              rawText: intent.rawText,
            },
          })
          continue
        }

        if (result.handledAsReject) {
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
              chunkId: chunk.id,
              action: 'rejected-existing',
              taskId: result.task.id,
              reasoning: intent.reasoning,
            },
          })
          continue
        }

        const task = result.task

        // approval/defer:不创建新 task,只更新现有
        if (!result.isNew) {
          this.emit({
            type: 'judgment/reasoning',
            data: {
              stage: 'decision',
              chunkId: chunk.id,
              action: 'merged',
              taskId: task.id,
              reasoning: intent.reasoning,
              relationTo: intent.relationTo,
            },
          })
          continue
        }

        // 推送决策
        this.emit({
          type: 'judgment/reasoning',
          data: {
            stage: 'decision',
            chunkId: chunk.id,
            action: 'created',
            taskId: task.id,
            intent: task.requirement.intent,
            target: task.llm?.target,
            confidence: task.llm?.confidence,
            reasoning: intent.reasoning,
            relationTo: intent.relationTo,
          },
        })

        const summary = this.taskQueue.getSummary(task.id)
        if (summary) {
          this.emit({ type: 'task/created', data: summary })
        }

        // 4. 评估可行性
        this.taskQueue.setStatus(task.id, 'analyzing', '正在评估可行性')
        this.emit({
          type: 'task/analyzing',
          data: { id: task.id, reasoning: '等待可行性评估' },
        })
        this.evaluateFeasibility(task.id)
      }

      // 没有匹配到任何意图 → unclear
      if (llmResult.intents.length === 0) {
        this.emit({
          type: 'judgment/reasoning',
          data: {
            stage: 'unclear',
            chunkId: chunk.id,
            text: chunk.text,
            note: 'LLM 和规则都没识别出明确意图,可能是不清晰的发言',
          },
        })
      }
    }

    this.checkTransitions()
    this.broadcastQueueState()
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

  private evaluateFeasibility(taskId: string): void {
    const task = this.taskQueue.get(taskId)
    if (!task) return

    // 简化版:基于代码地图和 intent 做规则判断
    let feasibility: import('../types/task.js').Feasibility = {
      technical: 'feasible' as const,
      workload: 'small' as const,
      riskLevel: 'low' as const,
      inWhitelist: true,
      codeMapRefs: [] as string[],
      reasoning: '在允许范围内(前端原型 CRUD)',
    }

    // 超出范围的判断
    const exceedsScope =
      /(架构|路由|权限|登录|支付|数据库|后端|API|部署)/.test(task.requirement.interpreted)

    if (exceedsScope) {
      feasibility = {
        technical: 'feasible',
        workload: 'medium',
        riskLevel: 'high',
        inWhitelist: false,
        codeMapRefs: [],
        reasoning: '涉及核心架构/权限/第三方,超出白名单',
      }
    }

    // 大工作量的判断
    const isLarge = /(整套|全部|整个|所有页面|整体)/.test(task.requirement.interpreted)
    if (isLarge) {
      feasibility = {
        technical: 'feasible',
        workload: 'large',
        riskLevel: 'medium',
        inWhitelist: true,
        codeMapRefs: [],
        reasoning: '工作量较大,建议拆分',
      }
    }

    // 加入 code map refs
    if (this.codeMap) {
      const refs = this.findCodeMapRefs(task.requirement.interpreted)
      feasibility.codeMapRefs = refs
    }

    this.taskQueue.setFeasibility(taskId, feasibility)

    this.emit({
      type: 'judgment/feasibility',
      data: { taskId, ...feasibility },
    })

    // 进入 confirmed 或 rejected
    if (feasibility.inWhitelist && feasibility.riskLevel !== 'high') {
      this.taskQueue.setStatus(taskId, 'confirmed', '可行性通过', '准备执行')
      this.emit({
        type: 'task/confirmed',
        data: { id: taskId, reason: feasibility.reasoning },
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
        this.taskQueue.setStatus(task.id, 'analyzing', '多人多次提及,开始评估')
        this.emit({
          type: 'task/analyzing',
          data: { id: task.id, reasoning: '多次提及,提升评估优先级' },
        })
        this.evaluateFeasibility(task.id)
      }
    }
  }

  private handleRejection(chunk: AsrChunk): void {
    // 已废弃:拒绝判定交给 LLM(通过 relationTo.rejects)
    // 保留方法避免编译错误,但不再调用
    logger.warn({ chunkId: chunk.id }, 'handleRejection called but deprecated')
  }

  private evictWindow(): void {
    const cutoff = Date.now() - this.options.windowMs
    while (this.window.length > 0 && this.window[0].timestamp < cutoff) {
      this.window.shift()
    }
  }

  private getRecentFinalChunks(): AsrChunk[] {
    return this.window.filter(c => c.isFinal || c.mode === 'offline')
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
