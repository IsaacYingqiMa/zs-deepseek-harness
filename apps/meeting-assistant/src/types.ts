/**
 * 前端类型 - 跟后端 types/task.ts 保持一致
 */

export type SpeakerId = 'boss' | 'pm' | 'dev' | 'unknown'

export type TaskStatus =
  | 'detected' | 'analyzing' | 'confirmed' | 'executing'
  | 'completed' | 'failed' | 'rejected' | 'deferred'
  | 'superseded'

export type TaskIntent =
  | 'add-feature' | 'modify-feature' | 'fix-bug' | 'delete-feature'
  | 'style-change' | 'data-change' | 'discussion' | 'unclear'

export interface AsrChunk {
  id: string
  text: string
  speaker: SpeakerId
  timestamp: number
  isFinal: boolean
  mode: 'online' | 'offline'
}

export interface Feasibility {
  technical: 'unknown' | 'feasible' | 'infeasible'
  workload: 'small' | 'medium' | 'large'
  riskLevel: 'low' | 'medium' | 'high'
  inWhitelist: boolean
  codeMapRefs: string[]
  reasoning: string
}

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
  llm?: {
    target: string | null
    confidence: number
    reasoning: string
  }
  relations?: {
    supersededBy?: string
    extends?: string
    conflicts?: string[]
  }
  currentChunkId?: string
}

export interface ProjectInfo {
  name: string
  path: string
  framework: string
  hasShadcn: boolean
  previewPort?: number
  /** 项目类型:pure-html 走静态服务 + 快速 dsh;framework 走 dev server + 完整 dsh */
  type: 'pure-html' | 'framework'
}

/**
 * 决策统计(跟后端 DecisionStats 类型对齐)
 *
 * 决策层(AI 决策流关注)vs 执行层(任务清单关注)严格分离:
 *
 *   决策层 5 数字:
 *     总决策 = requirements + chitchat
 *     需求   = feasible + infeasible
 *
 *   执行层指标:
 *     tasks / byStatus / executable / queued / rejected / executions
 *
 * 数字定义见后端 decision-stats.ts,前端只读不写
 */
export interface DecisionStats {
  /** 版本号(变化时强制重渲染) */
  version: number

  // ===== 决策层指标(LLM 判断,不可变) =====
  /** LLM 输出过的意图总数(含非需求) */
  totalIntents: number
  /** LLM 输出过的产品需求类意图数 */
  requirements: number
  /** LLM 输出过的非需求类意图数 */
  chitchat: number
  /** LLM 评估为可开发的需求数 */
  feasible: number
  /** LLM 评估为非可开发的需求数 */
  infeasible: number

  // ===== 执行层指标(task 状态聚合) =====
  tasks: number
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
  evaluating: number
  executable: number
  queued: number
  rejected: {
    total: number
    byFeasibility: number
    byUser: number
    bySystem: number
  }
  executions: {
    completed: number
    failed: number
  }
  updatedAt: number
}

/** DecisionLog 单条(给 DecisionLog 面板展示) */
export interface DecisionLogEntry {
  id: string
  at: number
  type:
    | 'intent_extracted'
    | 'task_created'
    | 'task_deduped'
    | 'task_approved'
    | 'task_rejected'
    | 'task_deferred'
    | 'task_superseded'
    | 'feasibility_evaluated'
    | 'task_executing'
    | 'task_completed'
    | 'task_failed'
  taskId: string | null
  chunkId: string | null
  speaker: string | null
  rawText: string | null
  reasoning: string | null
  beforeStatus: TaskStatus | null
  afterStatus: TaskStatus | null
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

export interface JudgmentEvent {
  type: string
  data?: unknown
}

export interface CodingStep {
  at: number
  type: 'thinking' | 'tool-call' | 'tool-result'
  text?: string
  toolName?: string
  toolArgs?: unknown
  callId?: string
  result?: string
  isError?: boolean
}

/**
 * Task 阶段 —— 4 阶段简化版,对应 zsspec 流程
 *
 * 阶段链路(单向推进):
 *   brain  (需求讨论) → spec (规格/变更) → apply (开发+测试) → done (验收)
 *
 * brain:  LLM 提取意图(task 进入 detected/analyzing)
 * spec:   可行性评估 + 规格生成(judgment/feasibility 触发)
 * apply:  dsh 改代码 + 测试(coding/tool-call 触发)
 * done:   任务成功(task/completed)
 * failed: 任务失败(task/failed)
 * idle:   还没开始,或已结束后的归零状态
 */
export type TaskPhase = 'brain' | 'spec' | 'apply' | 'done' | 'failed' | 'idle'

/** ASR 输入片段(给 JudgeModule 用,跟后端 AsrChunk 字段对齐) */
export interface AsrChunkRef {
  chunkId: string
  speaker: SpeakerId
  text: string
  timestamp: number
}

/**
 * 智能体工作状态(跟后端 AgentType / AgentState 对齐)
 * 给 AgentStatusRow 卡片展示
 *
 * 执行层 3 智能体(拆分后的):
 *   - 'spec-agent':  Spec 编写智能体(写 REQ/DES/TASK)
 *   - 'dev-agent':   开发智能体(改代码)
 *   - 'test-agent':  测试智能体(跑 lint/build/test)
 *
 * 'executor' 保留以兼容老数据(旧版本单一执行智能体)
 */
export type AgentType =
  | 'intent'
  | 'feasibility'
  | 'rule-fallback'
  | 'spec-agent'
  | 'dev-agent'
  | 'test-agent'
  | 'executor'

export type AgentState = 'idle' | 'working' | 'success' | 'failed' | 'timeout' | 'triggered'

export interface AgentStatus {
  agent: AgentType
  state: AgentState
  message?: string
  durationMs?: number
  updatedAt: number
}

/** 版本号 bump(每次代码改动触发,跟后端 VersionBumpData 对齐) */
export interface VersionBump {
  version: number
  files: string[]
  taskId?: string
  timestamp: number
}

/**
 * 模块智能体跑动历史
 *
 * 一个 module(代码里的一个具体模块/组件/页面)经过的所有智能体跑动记录
 *
 * 例:
 *   moduleId: 'WorkOrderTable'
 *   runs: [
 *     { agent: 'spec-agent', taskId: 'abc', status: 'success', startedAt: ... },
 *     { agent: 'dev-agent', taskId: 'abc', status: 'success', startedAt: ... },
 *     { agent: 'test-agent', taskId: 'abc', status: 'success', startedAt: ... }
 *   ]
 */
export interface ModuleAgentRun {
  id: string
  moduleId: string
  agent: AgentType
  taskId: string
  status: AgentState
  startedAt: number
  finishedAt?: number
  durationMs?: number
  summary?: string
  files?: string[]
}

/** 模块信息(简化) */
export interface ModuleInfo {
  id: string
  name: string
  filePath?: string
}

/**
 * JudgeModule —— 决策流的顶层结构
 *
 * 一次 judge() 调用 = 一个 module:
 *   - chunks: 该 judge 处理过的完整 ASR 输入窗口(多句话)
 *   - tasks:  该 judge 创建的所有 task 摘要(只展示"提取到的需求",不展示 chitchat / incomplete)
 */
export interface JudgeModule {
  /** 唯一 ID —— 通常用 primaryChunkId(或 firstPushAt+chunkId[0])生成 */
  judgeId: string
  /** 第一个 chunk 的时间戳(模块 header 用) */
  startedAt: number
  /** 窗口时间跨度 */
  windowSpanMs: number
  /** 该 judge 处理的所有 ASR chunks(完整对话) */
  chunks: AsrChunkRef[]
  /** 该 judge 创建的所有 task 摘要 */
  tasks: ModuleTask[]
}

/**
 * ModuleTask —— JudgeModule 里的单个 task 摘要
 *
 * 跟 task store 里的 tasks Map 同步(currentStatus / feasibility 等会随 task/* 事件实时更新)
 */
export interface ModuleTask {
  taskId: string
  /** 任务意图(add-feature / modify-feature / ...) */
  intent: TaskIntent
  /** 目标对象(改哪个字段/组件) */
  target: string | null
  /** LLM confidence */
  confidence: number
  /** LLM reasoning */
  reasoning: string
  /** LLM 引用的 sourceChunkId */
  sourceChunkId: string | null
  /** 当前任务状态(实时同步) */
  currentStatus: TaskStatus
  /** 可行性(rejected 时展示) */
  feasibility?: Feasibility
  /** 拒绝原因(rejected 时展示) */
  rejectionReason?: string
  /** 改动的文件(completed 时展示) */
  modifiedFiles?: string[]
  /** 完成时间戳 */
  completedAt?: number
}

export const STATUS_COLORS: Record<TaskStatus, string> = {
  detected: 'bg-slate-500',
  analyzing: 'bg-yellow-500',
  confirmed: 'bg-blue-500',
  executing: 'bg-purple-500 animate-pulse',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  rejected: 'bg-gray-700',
  deferred: 'bg-amber-700',
  superseded: 'bg-slate-600',
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  detected: '检测到',
  analyzing: '评估中',
  confirmed: '待执行',
  executing: '执行中',
  completed: '完成',
  failed: '失败',
  rejected: '拒绝',
  deferred: '暂存',
  superseded: '取代',
}

export const INTENT_LABELS: Record<TaskIntent, string> = {
  'add-feature': '加功能',
  'modify-feature': '改功能',
  'fix-bug': '修 BUG',
  'delete-feature': '删功能',
  'style-change': '样式',
  'data-change': '数据',
  'discussion': '讨论',
  'unclear': '不明确',
}

export const SPEAKER_COLORS: Record<SpeakerId, string> = {
  boss: 'text-boss',
  pm: 'text-pm',
  dev: 'text-dev',
  unknown: 'text-unknown',
}

export const SPEAKER_LABELS: Record<SpeakerId, string> = {
  boss: '老板',
  pm: '产品',
  dev: '开发',
  unknown: '?',
}
