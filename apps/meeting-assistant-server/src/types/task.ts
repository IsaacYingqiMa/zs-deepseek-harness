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

/**
 * 智能体工作状态 —— 决策层各模块运行状态
 *
 * 给前端 AgentStatusRow 组件展示用,体现"哪些智能体在干活 / 哪些干完"
 */
export type AgentType = 'intent' | 'feasibility' | 'rule-fallback' | 'executor'

export type AgentState =
  | 'idle'        // 空闲
  | 'working'     // 工作中
  | 'success'     // 上次成功
  | 'failed'      // 上次失败
  | 'timeout'     // 上次超时
  | 'triggered'   // 触发(用于 fallback)

/** 版本号 bump 数据(每次代码改动触发) */
export interface VersionBumpData {
  version: number
  files: string[]
  taskId?: string
  timestamp: number
}

/** 智能体状态更新事件 */
export interface AgentStatusData {
  agent: AgentType
  state: AgentState
  /** 可选描述(如"评估 task abc123" / "意图提取 5 个 chunk") */
  message?: string
  /** 工作耗时(ms,完成后回填) */
  durationMs?: number
  /** 事件时间戳 */
  timestamp: number
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
  /** 项目类型:pure-html 走静态服务 + 快速 dsh;framework 走 dev server + 完整 dsh */
  type: 'pure-html' | 'framework'
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

/**
 * 决策统计 —— 漏斗口径(决策维度 Task 状态层面)
 *
 * 数字含义固定,前端展示按这个走。每个数字都可追溯到具体 task。
 *
 * 漏斗:total > requirements > chitchat > tasks > evaluating > executable > queued > executing > done
 *  - requirements:  LLM 输出中真属于"产品需求"意图(add/modify/delete/fix/data-change)
 *  - chitchat:      LLM 输出中非需求意图(discussion/unclear)
 *  - tasks:         实际进入 TaskQueue 的 task 数(含 superseded/failed 等终态)
 *  - evaluating:    当前处于 analyzing 状态的 task
 *  - executable:    通过可行性评估、可以开发的需求(inWhitelist + risk!=high + workload!=large)
 *  - queued:        当前在调度队列中等待执行的 task
 *  - executing:     正在执行层跑
 *  - done:          completed + (terminal success)
 *
 * 拒绝细分:
 *  - rejectedByFeasibility: 可行性评估不通过(超范围 / 风险高 / 工作量大)
 *  - rejectedByUser:        用户驳回(LLM 输出 intent=rejection 或 relationTo.rejects)
 *  - rejectedBySystem:      触发引擎兜底拒绝(lead 中:feasible=infeasible 等)
 *
 * 数字更新语义:
 *  - "增量式"统计:每次状态变化都精确递增/递减,不靠重算(避免漏判)
 *  - 重置口径:clear() 会把所有 task 重新跑一遍统计 rebuild(用于会话切换)
 */
export interface DecisionStats {
  /** 自上次更新以来的版本号(用于前端判断要不要重渲染) */
  version: number

  /** LLM 输出过的意图总数(含非需求) */
  totalIntents: number
  /** LLM 输出过的需求类意图(add/modify/delete/fix/data-change) */
  requirements: number
  /** LLM 输出过的非需求意图(discussion/unclear/approval/reject/defer) */
  chitchat: number

  /**
   * 决策层指标(LLM 评估结果,不可变):
   *   - feasible:   LLM 评估为可开发的需求数
   *   - infeasible: LLM 评估为非可开发的需求数
   * 数学关系: requirements = feasible + infeasible
   */
  feasible: number
  infeasible: number

  /** 实际创建的 task 数(含终态) */
  tasks: number

  /** 当前处于各状态的 task 数(快照) */
  byStatus: {
    detected: number
    analyzing: number
    confirmed: number
    executing: number
    completed: number
    failed: number
    rejected: number
    deferred: number
    superseded: number
  }

  /** 评估中(analyzing 状态的当前值,等同于 byStatus.analyzing) */
  evaluating: number

  /** 可开发(confirmed + executing + completed) — 实际代表"通过可行性评估的数量" */
  executable: number

  /** 当前调度队列里等待的 task 数 */
  queued: number

  /** 拒绝细分(总数 = rejected + 部分 superseded) */
  rejected: {
    total: number
    byFeasibility: number
    byUser: number
    bySystem: number
  }

  /** 执行结果细分 */
  executions: {
    completed: number
    failed: number
  }

  /** 最后一次更新时间(epoch ms) */
  updatedAt: number
}

/**
 * 决策事件流(给前端 DecisionLog 面板用)—— Task 级别 timeline 增强版
 * 区别:DecisionLog 反映单个 task 的完整决策链;DecisionStats 反映全局数字
 */
export interface DecisionLogEntry {
  /** 唯一 ID(用作 React key) */
  id: string
  /** 事件时间 */
  at: number
  /** 事件类型 */
  type:
    | 'intent_extracted'       // LLM 输出意图
    | 'task_created'           // 新建 task
    | 'task_deduped'           // 去重合并(已存在)
    | 'task_approved'          // 用户确认
    | 'task_rejected'          // 用户驳回
    | 'task_deferred'          // 用户暂存
    | 'task_superseded'        // 被新需求取代
    | 'feasibility_evaluated'  // 可行性评估完成
    | 'task_executing'         // 进入执行
    | 'task_completed'         // 执行成功
    | 'task_failed'             // 执行失败
  /** 关联的 task(可能为 null —— 比如意图被丢弃) */
  taskId: string | null
  /** 关联到原始 ASR chunk */
  chunkId: string | null
  /** 说话人 */
  speaker: string | null
  /** 原始发言文本 */
  rawText: string | null
  /** LLM reasoning(若有) */
  reasoning: string | null
  /** 状态变化前(可选) */
  beforeStatus: TaskStatus | null
  /** 状态变化后(可选) */
  afterStatus: TaskStatus | null
  /** 详细 payload(按 type 含义不同) */
  details?: {
    intent?: string
    target?: string | null
    confidence?: number
    feasibility?: Feasibility
    modifiedFiles?: string[]
    error?: string
    mentionCount?: number
  }
}

/** 独立判断层推送给前端的事件 */
export type JudgmentEvent =
  | { type: 'asr/chunk'; data: AsrChunk }
  | { type: 'task/created'; data: TaskSummary }
  | { type: 'stats/updated'; data: DecisionStats }
  | { type: 'decision/log'; data: DecisionLogEntry }
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
  | { type: 'agent/status'; data: AgentStatusData }
  | { type: 'version/bump'; data: VersionBumpData }
  | {
    type: 'judgment/reasoning'
    data: {
      stage: 'input' | 'llm' | 'decision' | 'rejected' | 'unclear' | 'incomplete'
      /** 兼容旧字段:单 chunk 模式 */
      chunkId?: string
      /** 新字段:整窗口输入时的多 chunk 列表 */
      chunkIds?: string[]
      /** 整窗口原始 chunk 列表(input 阶段用,前端展开) */
      chunks?: Array<{
        chunkId: string
        speaker: string
        text: string
        timestamp: number
      }>
      /** 窗口时间跨度(ms) — input 阶段用 */
      windowSpanMs?: number
      text?: string
      intentCount?: number
      intents?: Array<{
        intent: string
        rawText: string
        interpreted: string
        target: string | null
        confidence: number
        relationTo: { taskId: string | null; type: string | null } | null
        sourceChunkId?: string | null
        reasoning: string
      }>
      action?: string
      taskId?: string
      intent?: string
      target?: string | null
      confidence?: number
      /** 决策所依据的原话来源 chunk(供前端高亮) */
      sourceChunkId?: string
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
