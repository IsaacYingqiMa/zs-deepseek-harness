import { create } from 'zustand'
import type { AsrChunk, TaskSummary, ProjectInfo, DecisionCard } from './types'

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

interface MeetingState {
  // 项目选择
  projects: ProjectInfo[]
  currentProject: { path: string; framework: string; previewUrl: string; port: number } | null
  codeMap: unknown

  // 录音状态
  isRecording: boolean
  meetingStartTime: number | null

  // ASR 转写
  asrChunks: AsrChunk[]
  // 当前正在累积的流式句子(没 isFinal 时累积,isFinal 才提交到 asrChunks)
  pendingSentence: string
  pendingSpeaker: string

  // 任务
  tasks: Map<string, TaskSummary>
  queueState: { queue: TaskSummary[]; current: TaskSummary | null }

  // AI 思考流(全局)
  aiReasoning: Array<{ at: number; type: string; text: string }>
  // 决策卡片流(LLM 推理过程,按 stage 分阶段)
  decisionCards: DecisionCard[]
  // Task 按输入轮次分组(chunkId → Task[])
  tasksByChunk: Map<string, string[]>

  // CodingAgent 步骤(每个 task 一份)
  codingSteps: Map<string, CodingStep[]>
  // 最近一次文件改动(触发 iframe reload)
  lastFilesChanged: { at: number; files: string[] } | null
  // iframe ref(Panel 组件注册,hooks 调用 reload)
  iframeRef: HTMLIFrameElement | null

  // WS 连接
  wsConnected: boolean

  // Actions
  setProjects: (p: ProjectInfo[]) => void
  setCurrentProject: (p: { path: string; framework: string; previewUrl: string; port: number }) => void
  setCodeMap: (m: unknown) => void
  setRecording: (r: boolean) => void
  addAsrChunk: (c: AsrChunk) => void
  clearAsrChunks: () => void
  addTask: (t: TaskSummary) => void
  updateTask: (id: string, changes: Partial<TaskSummary>) => void
  setQueueState: (q: { queue: TaskSummary[]; current: TaskSummary | null }) => void
  addReasoning: (r: { at: number; type: string; text: string }) => void
  addDecisionCard: (c: DecisionCard) => void
  addCodingStep: (taskId: string, step: CodingStep) => void
  clearCodingSteps: (taskId: string) => void
  setFilesChanged: (files: string[]) => void
  setIframeRef: (ref: HTMLIFrameElement | null) => void
  setWsConnected: (c: boolean) => void
  reset: () => void
}

export const useMeetingStore = create<MeetingState>(set => ({
  projects: [],
  currentProject: null,
  codeMap: null,
  isRecording: false,
  meetingStartTime: null,
  asrChunks: [],
  pendingSentence: '',
  pendingSpeaker: 'unknown',
  tasks: new Map(),
  queueState: { queue: [], current: null },
  aiReasoning: [],
  decisionCards: [],
  tasksByChunk: new Map(),
  codingSteps: new Map(),
  lastFilesChanged: null,
  iframeRef: null,
  wsConnected: false,

  setProjects: projects => set({ projects }),
  setCurrentProject: p => set({ currentProject: p }),
  setCodeMap: m => set({ codeMap: m }),
  setRecording: r => set({
    isRecording: r,
    meetingStartTime: r ? Date.now() : null,
  }),
  addAsrChunk: c => set((s) => {
    if (c.isFinal) {
      // FunASR 2pass-offline 的 text 已是完整句子(含全部增量)
      // 直接用它,不与 pendingSentence 拼接(否则内容×2)
      return {
        asrChunks: [...s.asrChunks, c].slice(-200),
        pendingSentence: '',
        pendingSpeaker: c.speaker,
      }
    }
    // 流式中间结果:只累积,不提交
    return {
      pendingSentence: s.pendingSentence
        ? `${s.pendingSentence} ${c.text}`.trim()
        : c.text,
      pendingSpeaker: c.speaker,
    }
  }),
  /** 强制把当前累积的句子作为 final 提交(录音停止时调用) */
  flushPendingSentence: () => set((s) => {
    if (!s.pendingSentence) return {}
    return {
      asrChunks: [...s.asrChunks, {
        id: `flushed-${Date.now()}`,
        text: s.pendingSentence,
        speaker: s.pendingSpeaker as AsrChunk['speaker'],
        timestamp: Date.now(),
        isFinal: true,
        mode: 'offline',
      }].slice(-200),
      pendingSentence: '',
    }
  }),
  clearAsrChunks: () => set({ asrChunks: [], aiReasoning: [], pendingSentence: '' }),
  addTask: t => set((s) => {
    const tasks = new Map(s.tasks)
    tasks.set(t.id, t)
    return { tasks }
  }),
  updateTask: (id, changes) => set((s) => {
    const tasks = new Map(s.tasks)
    const existing = tasks.get(id)
    if (existing) {
      tasks.set(id, { ...existing, ...changes })
    }
    return { tasks }
  }),
  setQueueState: q => set({ queueState: q }),
  addReasoning: r => set((s) => {
    const reasoning = [...s.aiReasoning, r].slice(-100)
    return { aiReasoning: reasoning }
  }),
  addDecisionCard: c => set((s) => {
    const cards = [...s.decisionCards, c].slice(-50)
    return { decisionCards: cards }
  }),
  addCodingStep: (taskId, step) => set((s) => {
    const steps = new Map(s.codingSteps)
    const existing = steps.get(taskId) || []
    steps.set(taskId, [...existing, step].slice(-100))
    return { codingSteps: steps }
  }),
  clearCodingSteps: taskId => set((s) => {
    const steps = new Map(s.codingSteps)
    steps.delete(taskId)
    return { codingSteps: steps }
  }),
  setFilesChanged: files => set({
    lastFilesChanged: { at: Date.now(), files },
  }),
  setIframeRef: ref => set({ iframeRef: ref }),
  addTaskToChunk: (chunkId, taskId) => set((s) => {
    const map = new Map(s.tasksByChunk)
    const existing = map.get(chunkId) || []
    map.set(chunkId, [...existing, taskId])
    return { tasksByChunk: map }
  }),
  setWsConnected: c => set({ wsConnected: c }),
  reset: () => set({
    asrChunks: [],
    pendingSentence: '',
    tasks: new Map(),
    queueState: { queue: [], current: null },
    aiReasoning: [],
    codingSteps: new Map(),
  }),
}))
