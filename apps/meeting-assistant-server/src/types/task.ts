/**
 * 核心类型定义 - 整个系统的数据契约
 *
 * 这是最关键的文件,所有模块都依赖这些类型。
 * 任何类型调整都会影响 judgment / dsh-adapter / api / 前端。
 */

/** ASR 转写的一个 chunk(从 FunASR 来的最小单位) */
export interface AsrChunk {
  /** 唯一 ID */
  id: string
  /** 原始转写文本 */
  text: string
  /** 说话人(2-3 人会议预设) */
  speaker: SpeakerId
  /** 时间戳 */
  timestamp: number
  /** 是否句尾最终结果 */
  isFinal: boolean
  /** FunASR mode: online=中间结果 / offline=句尾最终 */
  mode: 'online' | 'offline'
}

/** 预设说话人(2-3 人会议) */
export type SpeakerId = 'boss' | 'pm' | 'dev' | 'unknown'

/** Task 状态机 - 任务生命周期 */
export type TaskStatus =
  | 'detected'      // 刚识别出来
  | 'analyzing'     // 判断可行性中
  | 'confirmed'     // 已确认,等待触发
  | 'executing'     // 正在执行
  | 'completed'     // 完成
  | 'failed'        // 失败
  | 'rejected'      // 拒绝
  | 'deferred'     // 暂存
  | 'superseded'   // 被新需求取代

/** 意图分类 */
export type TaskIntent =
  | 'add-feature'     // 加新功能
  | 'modify-feature'  // 改已有
  | 'fix-bug'         // 修 BUG
  | 'delete-feature'  // 删功能
  | 'style-change'    // 样式
  | 'data-change'     // 数据/字段
  | 'discussion'      // 讨论中(不是需求)
  | 'unclear'        // 不明确

/** 可行性评估 */
export interface Feasibility {
  technical: 'unknown' | 'feasible' | 'infeasible'
  workload: 'small' | 'medium' | 'large'
  riskLevel: 'low' | 'medium' | 'high'
  inWhitelist: boolean
  codeMapRefs: string[]
  reasoning: string
}

/** 自主补全 */
export interface CompletionItem {
  field: string
  value: string
  reason: string
  source: 'auto-filled' | 'user-override'
}

/** Task 时间线事件 */
export interface TaskEvent {
  at: number
  status: TaskStatus
  reason: string
  evidence?: string
  /** LLM reasoning */
  reasoning?: string
}

/** CodingAgent 的执行步骤 */
export interface CodingStep {
  at: number
  type: 'thinking' | 'tool-call' | 'tool-result'
  /** thinking 时的文本 */
  text?: string
  /** tool-call 时的工具信息 */
  toolName?: string
  toolArgs?: unknown
  callId?: string
  /** tool-result 时的结果 */
  result?: string
  /** 是否错误 */
  isError?: boolean
}

/** Task 之间的关系 */
export interface TaskRelations {
  /** 被哪个新 task 取代了(supersedes) */
  supersededBy?: string
  /** 扩展了哪个旧 task(extends) */
  extends?: string
  /** 与哪些 task 冲突(conflicts) */
  conflicts?: string[]
}

/** 核心 Task 对象 */
export interface Task {
  id: string
  status: TaskStatus

  /** 来源追踪 */
  source: {
    asrChunkIds: string[]
    speakers: SpeakerId[]
    firstSeenAt: number
    lastSeenAt: number
    mentionCount: number
    transcript: TranscriptSegment[]
    /** 触发这一轮输入的 chunk id(用于前端分组) */
    currentChunkId?: string
  }

  /** 关系 */
  relations?: TaskRelations

  /** LLM 提取的详细信息 */
  llm?: {
    target: string | null
    confidence: number
    reasoning: string
  }

  /** 需求内容 */
  requirement: {
    raw: string
    interpreted: string
    intent: TaskIntent
    keywords: string[]
  }

  /** 可行性 */
  feasibility: Feasibility

  /** 自主补全 */
  completions: {
    autoFilled: CompletionItem[]
    userOverrides: CompletionItem[]
  }

  /** 执行 */
  execution: {
    dshRequestId?: string
    startedAt?: number
    finishedAt?: number
    error?: string
    modifiedFiles?: string[]
    log?: ExecutionLogEntry[]
  }

  /** 时间线 */
  timeline: TaskEvent[]
}

/** 转写片段(关联 ASR 原文) */
export interface TranscriptSegment {
  chunkId: string
  speaker: SpeakerId
  text: string
  at: number
}

/** 执行日志条目 */
export interface ExecutionLogEntry {
  at: number
  type: 'tool-call' | 'tool-result' | 'assistant-text' | 'error'
  toolName?: string
  toolArgs?: unknown
  toolResult?: unknown
  text?: string
}

/** 任务摘要(给前端展示用,简化版) */
export interface TaskSummary {
  id: string
  status: TaskStatus
  interpreted: string
  intent: TaskIntent
  mentionCount: number
  speakers: SpeakerId[]
  feasibility: Feasibility
  completedAt?: number
  modifiedFiles?: string[]
  rejectionReason?: string

  /** LLM 提取信息 */
  llm?: {
    target: string | null
    confidence: number
    reasoning: string
  }

  /** Task 关系 */
  relations?: TaskRelations

  /** 当前轮 chunk id(用于前端按轮分组) */
  currentChunkId?: string
}

/** 规则引擎信号 */
export interface Signal {
  type: 'requirement' | 'discussion' | 'chitchat' | 'bug'
  confidence: number
  text: string
  matchedPattern?: string
}

/** 规则匹配结果 */
export interface RuleResult {
  signals: Signal[]
  intent: TaskIntent
  keywords: string[]
}

/** LLM 辅助理解结果 */
export interface LlmUnderstanding {
  tasks: Array<{
    intent: TaskIntent
    rawText: string
    interpreted: string
    confidence: number
    isNewTopic: boolean
  }>
}

/** Code Map 节点(项目文件结构缓存) */
export interface CodeMapNode {
  path: string
  type: 'file' | 'directory' | 'component' | 'api-route' | 'model' | 'page'
  framework?: string
  description?: string
  exports?: string[]
}

/** Code Map(整个项目的结构) */
export interface CodeMap {
  root: string
  framework: string
  components: CodeMapNode[]
  apiRoutes: CodeMapNode[]
  models: CodeMapNode[]
  pages: CodeMapNode[]
  generatedAt: number
}

/** 项目信息(下拉选择用) */
export interface ProjectInfo {
  name: string
  path: string
  framework: string
  hasShadcn: boolean
  previewPort?: number
}

/** 给 dsh 的执行指令(结构化任务) */
export interface DshExecutionTask {
  taskId: string
  instruction: string
  codeMapRefs: string[]
  constraints: {
    maxFiles: number
    mustNotTouch: string[]
    requiredChecks: string[]
  }
}

/** 从 dsh 来的事件(节选关键类型) */
export type DshEvent =
  | { type: 'assistant/text-delta'; delta: string; seq: number }
  | { type: 'assistant/message/end' }
  | { type: 'assistant/error'; error: string }
  | { type: 'tool/call'; name: string; args: unknown; callId: string }
  | { type: 'tool/result'; callId: string; result: unknown }

/** 独立判断层推送给前端的事件 */
export type JudgmentEvent =
  | { type: 'asr/chunk'; data: AsrChunk }
  | { type: 'task/created'; data: TaskSummary }
  | { type: 'task/updated'; data: { id: string; changes: Partial<Task> } }
  | { type: 'task/analyzing'; data: { id: string; reasoning: string } }
  | { type: 'task/confirmed'; data: { id: string; reason: string } }
  | { type: 'task/executing'; data: { id: string } }
  | { type: 'task/completed'; data: { id: string; files: string[]; duration: number } }
  | { type: 'task/rejected'; data: { id: string; reason: string } }
  | { type: 'task/deferred'; data: { id: string; reason: string } }
  | { type: 'judgment/signal'; data: Signal & { chunkId: string } }
  | { type: 'judgment/feasibility'; data: { taskId: string } & Feasibility }
  | { type: 'judgment/completion'; data: { taskId: string; completions: CompletionItem[] } }
  | { type: 'execution/log'; data: { taskId: string; entry: ExecutionLogEntry } }
  | { type: 'execution/tool-call'; data: { taskId: string; callId: string; name: string; args: unknown } }
  | { type: 'execution/tool-result'; data: { taskId: string; callId: string; result: unknown } }
  | { type: 'coding/thinking'; data: { taskId: string; text: string } }
  | { type: 'coding/tool-call'; data: { taskId: string; callId: string; name: string; args: unknown } }
  | { type: 'coding/tool-result'; data: { taskId: string; callId: string; result: string; isError: boolean } }
  | { type: 'queue/state'; data: { queue: TaskSummary[]; current: TaskSummary | null } }
  | {
    type: 'judgment/reasoning'
    data: {
      stage: 'input' | 'llm' | 'decision' | 'rejected' | 'unclear'
      chunkId?: string
      text?: string
      intentCount?: number
      intents?: Array<{
        intent: string
        rawText: string
        interpreted: string
        target: string | null
        confidence: number
        relationTo: { taskId: string | null; type: string | null } | null
        reasoning: string
      }>
      action?: string
      taskId?: string
      intent?: string
      target?: string | null
      confidence?: number
      reasoning?: string
      relationTo?: { taskId: string | null; type: string | null } | null
      recentTasksCount?: number
      timestamp?: number
      reason?: string
      note?: string
      rawText?: string
    }
  }
  | {
    type: 'task/relations'
    data: { taskId: string; relatedTaskId: string; relationType: 'supersedes' | 'extends' | 'conflicts' | 'rejects'; description: string }
  }
