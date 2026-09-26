import { create } from 'zustand'
import type {
  AsrChunk, TaskSummary, ProjectInfo, DecisionStats, DecisionLogEntry,
  JudgeModule, ModuleTask, AsrChunkRef, AgentStatus, AgentType, TaskPhase,
  ModuleAgentRun, VersionBump,
} from './types'
// ModuleInfo removed as alias

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
  currentProject: { path: string; framework: string; previewUrl: string; port: number; type: 'pure-html' | 'framework' } | null
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

  // ★ JudgeModule —— 决策流的核心数据结构
  // 一次 judge() = 一个 module,内含 ASR 来源 + 创建的 task 列表
  modules: JudgeModule[]
  // Task 按输入轮次分组(chunkId → Task[])
  tasksByChunk: Map<string, string[]>

  // ★ 决策统计(StatsBar 用)
  stats: DecisionStats | null
  // ★ 决策日志(DecisionLog 面板用,可选)
  decisionLog: DecisionLogEntry[]

  // CodingAgent 步骤(每个 task 一份)
  codingSteps: Map<string, CodingStep[]>
  // 最近一次文件改动(触发 iframe reload)
  lastFilesChanged: { at: number; files: string[] } | null
  // iframe ref(Panel 组件注册,hooks 调用 reload)
  iframeRef: HTMLIFrameElement | null

  // ★ 版本号追踪
  currentVersion: number
  versionHistory: VersionBump[]

  // ★ 智能体工作状态(7 个智能体)
  // - intent / feasibility / rule-fallback(判断层)
  // - spec-agent / dev-agent / test-agent(执行层,3 阶段拆分)
  // - executor(老版本单一执行,继续保留以兼容)
  agents: {
    intent: AgentStatus | null
    feasibility: AgentStatus | null
    ruleFallback: AgentStatus | null
    executor: AgentStatus | null
    specAgent: AgentStatus | null
    devAgent: AgentStatus | null
    testAgent: AgentStatus | null
  }

  // ★ 模块的 agent 跑动历史(模块 → AgentRun[])
  moduleAgentHistory: Map<string, ModuleAgentRun[]>

  // ★ dsh 执行阶段(每个 task 当前的执行阶段:思考/开发/测试/完成)
  taskPhases: Map<string, TaskPhase>

  // WS 连接
  wsConnected: boolean

  // Actions
  setProjects: (p: ProjectInfo[]) => void
  setCurrentProject: (p: { path: string; framework: string; previewUrl: string; port: number; type: 'pure-html' | 'framework' } | null) => void
  setCodeMap: (m: unknown) => void
  setRecording: (r: boolean) => void
  addAsrChunk: (c: AsrChunk) => void
  clearAsrChunks: () => void
  addTask: (t: TaskSummary) => void
  updateTask: (id: string, changes: Partial<TaskSummary>) => void
  setQueueState: (q: { queue: TaskSummary[]; current: TaskSummary | null }) => void
  addCodingStep: (taskId: string, step: CodingStep) => void
  clearCodingSteps: (taskId: string) => void
  setFilesChanged: (files: string[]) => void
  setStats: (s: DecisionStats) => void
  addDecisionLog: (entry: DecisionLogEntry) => void
  setIframeRef: (ref: HTMLIFrameElement | null) => void
  setWsConnected: (c: boolean) => void
  addTaskToChunk: (chunkId: string, taskId: string) => void
  // ★ 更新智能体状态(AgentStatusRow 组件订阅)
  setAgentStatus: (agent: AgentType, status: AgentStatus) => void
  // ★ 更新 task 执行阶段(ProgressBar 渲染用)
  setTaskPhase: (taskId: string, phase: TaskPhase) => void
  // ★ 记录一次模块智能体跑动
  recordModuleAgentRun: (run: ModuleAgentRun) => void
  // ★ 接收版本号 bump(自动 +1,保留历史)
  applyVersionBump: (bump: VersionBump) => void
  reset: () => void

  // ★ Module 相关 actions
  /** 创建/更新一个 module(input 阶段调用) */
  upsertModule: (params: {
    judgeId: string
    startedAt: number
    windowSpanMs: number
    chunks: AsrChunkRef[]
  }) => void
  /** 给 module 加一个 task(decision 阶段调用) */
  addModuleTask: (judgeId: string, task: ModuleTask) => void
  /** 同步 module 里某个 task 的状态(task/* 事件调用) */
  syncModuleTask: (taskId: string, changes: Partial<ModuleTask>) => void
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
  modules: [],
  tasksByChunk: new Map(),
  stats: null,
  decisionLog: [],
  codingSteps: new Map(),
  lastFilesChanged: null,
  iframeRef: null,
  wsConnected: false,
  agents: {
    intent: null,
    feasibility: null,
    ruleFallback: null,
    executor: null,
    specAgent: null,
    devAgent: null,
    testAgent: null,
  },
  taskPhases: new Map(),
  moduleAgentHistory: new Map(),
  currentVersion: 1,
  versionHistory: [],

  setProjects: (projects) => { set({ projects }) },
  setCurrentProject: (p) => { set({ currentProject: p }) },
  setCodeMap: (m) => { set({ codeMap: m }) },
  setRecording: (r) => {
    set({
      isRecording: r,
      meetingStartTime: r ? Date.now() : null,
    })
  },
  /**
   * 创建或更新一个 JudgeModule
   * - 如果 judgeId 已存在,只更新 chunks
   * - 如果不存在,新建 module,tasks 为空
   */
  upsertModule: (params) => { set((s) => {
    const idx = s.modules.findIndex(m => m.judgeId === params.judgeId)
    if (idx >= 0) {
      const modules = [...s.modules]
      modules[idx] = {
        ...modules[idx],
        startedAt: params.startedAt,
        windowSpanMs: params.windowSpanMs,
        chunks: params.chunks,
      }
      return { modules }
    }
    const newModule: JudgeModule = {
      judgeId: params.judgeId,
      startedAt: params.startedAt,
      windowSpanMs: params.windowSpanMs,
      chunks: params.chunks,
      tasks: [],
    }
    return { modules: [...s.modules, newModule] }
  }) },
  addAsrChunk: (c) => {
    set((s) => {
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
    })
  },
  /** 强制把当前累积的句子作为 final 提交(录音停止时调用) */
  flushPendingSentence: () => { set((s) => {
    if (!s.pendingSentence) return {}
    const flushed: AsrChunk = {
      id: `flushed-${Date.now()}`,
      text: s.pendingSentence,
      speaker: s.pendingSpeaker as AsrChunk['speaker'],
      timestamp: Date.now(),
      isFinal: true,
      mode: 'offline',
    }
    return {
      asrChunks: [...s.asrChunks, flushed].slice(-200),
      pendingSentence: '',
    }
  }) },
  clearAsrChunks: () => { set({ asrChunks: [], pendingSentence: '' }) },
  addTask: (t) => { set((s) => {
    const tasks = new Map(s.tasks)
    tasks.set(t.id, t)
    return { tasks }
  }) },
  updateTask: (id, changes) => { set((s) => {
    const tasks = new Map(s.tasks)
    const existing = tasks.get(id)
    if (existing) {
      tasks.set(id, { ...existing, ...changes })
    }
    return { tasks }
  }) },
  setQueueState: (q) => { set({ queueState: q }) },
  addCodingStep: (taskId, step) => { set((s) => {
    const steps = new Map(s.codingSteps)
    const existing = steps.get(taskId) || []
    steps.set(taskId, [...existing, step].slice(-100))
    return { codingSteps: steps }
  }) },
  clearCodingSteps: (taskId) => { set((s) => {
    const steps = new Map(s.codingSteps)
    steps.delete(taskId)
    return { codingSteps: steps }
  }) },
  setFilesChanged: (files) => { set({
    lastFilesChanged: { at: Date.now(), files },
  }) },
  setStats: (s) => { set({ stats: s }) },
  addDecisionLog: (entry) => { set((s) => {
    const log = [...s.decisionLog, entry].slice(-200)
    return { decisionLog: log }
  }) },
  setIframeRef: (ref) => { set({ iframeRef: ref }) },
  setAgentStatus: (agent, status) => { set(s => ({
    agents: { ...s.agents, [agent]: status },
  })) },
  recordModuleAgentRun: (run) => { set((s) => {
    const next = new Map(s.moduleAgentHistory)
    const existing = next.get(run.moduleId) || []
    next.set(run.moduleId, [...existing, run])
    return { moduleAgentHistory: next }
  }) },

  // ★ 应用版本号 bump:加到 versionHistory + 更新 currentVersion
  applyVersionBump: (bump) => { set((s) => {
    const history = [...s.versionHistory, bump].slice(-50)
    return {
      currentVersion: bump.version,
      versionHistory: history,
      lastFilesChanged: { at: bump.timestamp, files: bump.files },
    }
  }) },
  // getModuleAgentRuns: 通过 hooks 中的 selector 实现(见 hooks.ts)
  setTaskPhase: (taskId, phase) => { set((s) => {
    const next = new Map(s.taskPhases)
    next.set(taskId, phase)
    return { taskPhases: next }
  }) },
  addTaskToChunk: (chunkId, taskId) => { set((s) => {
    const map = new Map(s.tasksByChunk)
    const existing = map.get(chunkId) || []
    map.set(chunkId, [...existing, taskId])
    return { tasksByChunk: map }
  }) },
  setWsConnected: (c) => { set({ wsConnected: c }) },
  reset: () => { set({
    asrChunks: [],
    pendingSentence: '',
    tasks: new Map(),
    queueState: { queue: [], current: null },
    modules: [],
    codingSteps: new Map(),
    stats: null,
    decisionLog: [],
    agents: {
      intent: null,
      feasibility: null,
      ruleFallback: null,
      executor: null,
      specAgent: null,
      devAgent: null,
      testAgent: null,
    },
    taskPhases: new Map(),
    moduleAgentHistory: new Map(),
    currentVersion: 1,
    versionHistory: [],
  }) },

  addModuleTask: (judgeId, task) => { set((s) => {
    const idx = s.modules.findIndex(m => m.judgeId === judgeId)
    if (idx < 0) return {}  // 没找到对应 module,忽略
    const module = s.modules[idx]
    // 同一 task 可能被多次推送(各种 stage 重复),去重
    if (module.tasks.find(t => t.taskId === task.taskId)) {
      // 已存在,合并 updates
      const tasks = module.tasks.map(t =>
        t.taskId === task.taskId ? { ...t, ...task } : t,
      )
      const modules = [...s.modules]
      modules[idx] = { ...module, tasks }
      return { modules }
    }
    const modules = [...s.modules]
    modules[idx] = { ...module, tasks: [...module.tasks, task] }
    return { modules }
  }) },

  /** 同步 module 里某个 task 的状态(从 task store 拿最新) */
  syncModuleTask: (taskId, changes) => { set((s) => {
    const modules = s.modules.map((m) => {
      const taskIdx = m.tasks.findIndex(t => t.taskId === taskId)
      if (taskIdx < 0) return m
      const tasks = [...m.tasks]
      tasks[taskIdx] = { ...tasks[taskIdx], ...changes }
      return { ...m, tasks }
    })
    return { modules }
  }) },
}))
