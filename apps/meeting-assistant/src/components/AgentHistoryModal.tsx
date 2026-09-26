/**
 * AgentHistoryModal —— 智能体跑动历史弹窗
 *
 * 点击 AgentStatusRow 中的 Spec/Dev/Test 卡片 → 弹出此弹窗
 *
 * 显示:
 *   - 该 agent 跑过的所有模块(按时间倒序)
 *   - 每个模块的状态(success / failed / working)
 *   - 每次跑的 task id / duration / summary / files
 *   - 点击某次跑动 → 展开看更多细节
 *
 * 关键技术点:用 React Portal 渲染到 document.body,
 * 避免父级 backdrop-filter / transform 等 CSS 创建新的 containing block,
 * 导致 fixed 定位失效。
 */
import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  X, FileText, Code2, FlaskConical, Check, XCircle, Loader2, Clock, Folder,
  Brain, ShieldCheck, Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useMeetingStore } from '../store'
import type { AgentType, ModuleAgentRun, AgentState } from '../types'

const STATUS_STYLE: Record<AgentState, { icon: LucideIcon; color: string; bg: string; label: string }> = {
  idle:      { icon: Clock,        color: 'text-slate-400',   bg: 'bg-slate-800/50',       label: '待机' },
  success:   { icon: Check,        color: 'text-green-300',   bg: 'bg-green-900/40',       label: '成功' },
  working:   { icon: Loader2,      color: 'text-yellow-300',  bg: 'bg-yellow-900/40',      label: '工作中' },
  failed:    { icon: XCircle,      color: 'text-red-300',     bg: 'bg-red-900/40',         label: '失败' },
  timeout:   { icon: Clock,        color: 'text-orange-300',  bg: 'bg-orange-900/40',      label: '超时' },
  triggered: { icon: Loader2,      color: 'text-purple-300',  bg: 'bg-purple-900/40',      label: '已触发' },
}

function formatDuration(ms?: number): string {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString()
}

export function AgentHistoryModal({
  agentType,
  onClose,
}: {
  agentType: AgentType
  onClose: () => void
}) {
  const moduleAgentHistory = useMeetingStore(s => s.moduleAgentHistory)
  const agents = useMeetingStore(s => s.agents)
  const tasks = useMeetingStore(s => s.tasks)

  type AgentInfo = { label: string; icon: LucideIcon; theme: string }

  const AGENT_INFO_MAP: Record<string, AgentInfo> = {
    'intent':        { label: '意图提取',    icon: Brain,       theme: 'cyan' },
    'feasibility':   { label: '可行性评估',  icon: ShieldCheck, theme: 'cyan' },
    'rule-fallback': { label: '规则 Fallback', icon: Zap,      theme: 'purple' },
    'spec-agent':    { label: 'Spec 编写',   icon: FileText,    theme: 'yellow' },
    'dev-agent':     { label: '开发',        icon: Code2,       theme: 'yellow' },
    'test-agent':    { label: '测试',        icon: FlaskConical, theme: 'yellow' },
  }

  const agentInfo: AgentInfo = AGENT_INFO_MAP[agentType] ?? { label: agentType, icon: FileText, theme: 'yellow' }

  // 收集所有模块 → 该 agent 的跑动
  const moduleRuns = useMemo(() => {
    const out: Array<{ moduleId: string; runs: ModuleAgentRun[] }> = []
    for (const [moduleId, runs] of moduleAgentHistory.entries()) {
      const filtered = runs.filter(r => r.agent === agentType)
      if (filtered.length > 0) {
        out.push({ moduleId, runs: filtered })
      }
    }
    // 按最近跑动时间倒序
    out.sort((a, b) => {
      const aLast = Math.max(...a.runs.map(r => r.startedAt))
      const bLast = Math.max(...b.runs.map(r => r.startedAt))
      return bLast - aLast
    })
    return out
  }, [moduleAgentHistory, agentType])

  const currentStatus = (() => {
    // store key 是驼峰,AgentType 是 kebab-case
    const key = agentType === 'rule-fallback' ? 'ruleFallback'
      : agentType === 'spec-agent' ? 'specAgent'
        : agentType === 'dev-agent' ? 'devAgent'
          : agentType === 'test-agent' ? 'testAgent'
            : agentType  // intent / feasibility 直接用
    return agents[key] ?? null
  })()

  const totalRuns = moduleRuns.reduce((s, m) => s + m.runs.length, 0)

  // ★ 用 Portal 渲染到 document.body,绕开父级 CSS(backdrop-filter 等)
  //   否则 fixed 定位会相对于 header 而不是 viewport
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => { e.stopPropagation() }}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <agentInfo.icon className="w-5 h-5 text-yellow-400" />
            <h2 className="text-base font-semibold text-slate-100">
              {agentInfo.label}智能体 · 跑动历史
            </h2>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
              {totalRuns} 次跑动 · {moduleRuns.length} 个模块
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 当前状态 */}
        {currentStatus && (
          <div className="px-5 py-2 bg-slate-800/30 border-b border-slate-800 flex items-center gap-3">
            <span className="text-[10px] text-slate-500">当前状态:</span>
            <span className={`text-xs ${STATUS_STYLE[currentStatus.state].color}`}>
              {STATUS_STYLE[currentStatus.state].label}
            </span>
            {currentStatus.message && (
              <span className="text-xs text-slate-400 truncate">
                {currentStatus.message}
              </span>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {moduleRuns.length === 0 ? (
            <div className="text-center text-slate-500 py-12">
              <agentInfo.icon className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <div className="text-sm">该智能体还没跑过任何模块</div>
              <div className="text-xs text-slate-600 mt-1">等会议里有需求被识别后,会自动出现在这里</div>
            </div>
          ) : (
            moduleRuns.map(({ moduleId, runs }) => (
              <ModuleSection
                key={moduleId}
                moduleId={moduleId}
                runs={runs}
                agentType={agentType}
                tasks={tasks}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-slate-700 flex items-center justify-between text-[10px] text-slate-500">
          <span>每个模块记录该智能体的所有跑动历史(成功 / 失败 / 工作中)</span>
          <button onClick={onClose} className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300">
            关闭
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ModuleSection({
  moduleId,
  runs,
  tasks,
}: {
  moduleId: string
  runs: ModuleAgentRun[]
  agentType: AgentType
  tasks: Map<string, { interpreted: string }>
}) {
  return (
    <div className="bg-slate-800/40 border border-slate-700 rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-700/50 flex items-center gap-2 bg-slate-800/40">
        <Folder className="w-3.5 h-3.5 text-yellow-400" />
        <span className="text-xs font-medium text-slate-200">{moduleId}</span>
        <span className="text-[10px] text-slate-500">·</span>
        <span className="text-[10px] text-slate-500">{runs.length} 次跑动</span>
      </div>
      <div className="divide-y divide-slate-700/50">
        {runs.map((run) => {
          const style = STATUS_STYLE[run.status]
          const StatusIcon = style.icon
          const task = tasks.get(run.taskId)
          return (
            <div key={run.id} className="px-3 py-2.5">
              <div className="flex items-start gap-2">
                <div className={`shrink-0 w-6 h-6 rounded-full ${style.bg} flex items-center justify-center`}>
                  <StatusIcon className={`w-3.5 h-3.5 ${style.color} ${run.status === 'working' ? 'animate-spin' : ''}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className={`font-medium ${style.color}`}>{style.label}</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-slate-500">{formatTime(run.startedAt)}</span>
                    {run.durationMs !== undefined && (
                      <>
                        <span className="text-slate-600">·</span>
                        <span className="text-slate-500">耗时 {formatDuration(run.durationMs)}</span>
                      </>
                    )}
                  </div>
                  {task && (
                    <div className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">
                      {task.interpreted}
                    </div>
                  )}
                  {run.summary && (
                    <div className="text-[10px] text-slate-500 mt-1 italic">
                      {run.summary}
                    </div>
                  )}
                  {run.files && run.files.length > 0 && (
                    <div className="text-[10px] font-mono text-green-400 mt-1 space-y-0.5">
                      {run.files.map(f => (
                        <div key={f} className="truncate">· {f}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
