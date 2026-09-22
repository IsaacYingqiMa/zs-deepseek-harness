/**
 * 前端类型 - 跟后端 types/task.ts 保持一致
 */

export type SpeakerId = 'boss' | 'pm' | 'dev' | 'unknown'

export type TaskStatus =
  | 'detected' | 'analyzing' | 'confirmed' | 'executing'
  | 'completed' | 'failed' | 'rejected' | 'deferred'

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

/** 决策阶段(给前端展示) */
export type DecisionStage = 'input' | 'llm' | 'decision' | 'rejected' | 'unclear'

export interface DecisionCard {
  at: number
  stage: DecisionStage
  chunkId?: string
  // input 阶段
  text?: string
  recentTasksCount?: number
  // llm 阶段
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
  // decision 阶段
  action?: string
  taskId?: string
  intent?: string
  target?: string | null
  confidence?: number
  reasoning?: string
  relationTo?: { taskId: string | null; type: string | null } | null
  // rejected / unclear 阶段
  reason?: string
  rawText?: string
  note?: string
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
