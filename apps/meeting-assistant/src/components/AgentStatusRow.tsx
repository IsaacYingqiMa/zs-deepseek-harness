/**
 * AgentStatusRow —— 智能体集群(震撼版 v2)
 *
 * 6 个独立的"Agent 机器人"卡片,横向铺开,体现多智能体协同自主:
 *
 *   意图 Agent | 可行性 Agent | 规则 Agent | Spec Agent | 开发 Agent | 测试 Agent
 *
 * 数字外露(用户能直接看到"我干了多少"):
 *   - 每个智能体卡片:跑动次数 + 当前状态文字
 *   - 顶部全局统计:总跑动 / 完成 / 失败
 *   - 底部流光条:集群整体活跃度(可视化)
 *
 * 动效:
 *   - 工作中节点:辐射光圈 + 流光线 + 任务粒子
 *   - 完成节点:绿色光呼吸 2s
 *   - 失败节点:红色抖动 + 错误光晕
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Brain, ShieldCheck, Zap, FileText, Code2, FlaskConical,
  Circle, Loader2, Check, X, Clock,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useMeetingStore } from '../store'
import type { AgentState, AgentType } from '../types'
import { AgentHistoryModal } from './AgentHistoryModal'

const IDLE_TIMEOUT_MS = 5000

type StoreKey =
  | 'intent' | 'feasibility' | 'ruleFallback'
  | 'specAgent' | 'devAgent' | 'testAgent'
  | 'executor'

function agentTypeToStoreKey(t: AgentType): StoreKey {
  switch (t) {
    case 'intent': return 'intent'
    case 'feasibility': return 'feasibility'
    case 'rule-fallback': return 'ruleFallback'
    case 'spec-agent': return 'specAgent'
    case 'dev-agent': return 'devAgent'
    case 'test-agent': return 'testAgent'
    case 'executor': return 'executor'
  }
}

/**
 * 智能体节点定义
 * 6 个"机器人",横向铺开
 */
interface AgentNode {
  type: AgentType
  label: string       // 显示名
  sublabel: string    // 副标(干什么的)
  icon: LucideIcon
  theme: 'cyan' | 'green' | 'purple' | 'yellow'
  showHistory: boolean
}

const AGENT_CLUSTER: AgentNode[] = [
  { type: 'intent',        label: '意图',     sublabel: '听需求', icon: Brain,         theme: 'cyan',   showHistory: true  },
  { type: 'feasibility',   label: '可行性',   sublabel: '评估',   icon: ShieldCheck,   theme: 'cyan',   showHistory: true  },
  { type: 'rule-fallback', label: '规则',     sublabel: '兜底',   icon: Zap,           theme: 'purple', showHistory: true  },
  { type: 'spec-agent',    label: 'Spec',     sublabel: '写规格', icon: FileText,      theme: 'yellow', showHistory: true  },
  { type: 'dev-agent',     label: '开发',     sublabel: '改代码', icon: Code2,         theme: 'yellow', showHistory: true  },
  { type: 'test-agent',    label: '测试',     sublabel: '验证',   icon: FlaskConical,  theme: 'yellow', showHistory: true  },
]

const STATE_STYLE: Record<AgentState, {
  bg: string
  border: string
  bar: string
  text: string
  icon: LucideIcon
  spin?: boolean
  glow: string
}> = {
  idle: {
    bg: 'bg-slate-900/60',
    border: 'border-slate-800',
    bar: 'bg-slate-700',
    text: 'text-slate-500',
    icon: Circle,
    glow: '',
  },
  working: {
    bg: 'bg-yellow-950/40',
    border: 'border-yellow-500/80',
    bar: 'bg-yellow-400',
    text: 'text-yellow-300',
    icon: Loader2,
    spin: true,
    glow: 'shadow-[0_0_24px_rgba(234,179,8,0.7)]',
  },
  success: {
    bg: 'bg-green-950/40',
    border: 'border-green-500/80',
    bar: 'bg-green-400',
    text: 'text-green-300',
    icon: Check,
    glow: 'shadow-[0_0_20px_rgba(34,197,94,0.6)]',
  },
  failed: {
    bg: 'bg-red-950/40',
    border: 'border-red-500/80',
    bar: 'bg-red-400',
    text: 'text-red-300',
    icon: X,
    glow: 'shadow-[0_0_20px_rgba(239,68,68,0.6)]',
  },
  timeout: {
    bg: 'bg-orange-950/40',
    border: 'border-orange-500/80',
    bar: 'bg-orange-400',
    text: 'text-orange-300',
    icon: Clock,
    glow: 'shadow-[0_0_18px_rgba(249,115,22,0.6)]',
  },
  triggered: {
    bg: 'bg-purple-950/40',
    border: 'border-purple-500/80',
    bar: 'bg-purple-400',
    text: 'text-purple-300',
    icon: Zap,
    glow: 'shadow-[0_0_18px_rgba(168,85,247,0.6)]',
  },
}

/**
 * 单个 Agent 卡片
 * 显示:图标 + Agent 名称 + 跑动次数 + 当前状态
 */
function AgentCard({
  node,
  state,
  runCount,
  successCount,
  onClick,
}: {
  node: AgentNode
  state: AgentState
  runCount: number
  successCount: number
  onClick: () => void
}) {
  const style = STATE_STYLE[state]
  const Icon = node.icon
  const StatusIcon = style.icon
  const isWorking = state === 'working'
  const isSuccess = state === 'success'
  const isFailed = state === 'failed'

  // 状态文字
  const stateLabel = isWorking ? '工作中...' :
    isSuccess ? '✓ 已完成' :
      isFailed ? '✗ 失败' :
        state === 'timeout' ? '⏱ 超时' :
          state === 'triggered' ? '⚡ 已触发' :
            '待命中'

  return (
    <button
      onClick={onClick}
      disabled={!node.showHistory}
      className={`relative w-full h-[88px] rounded-lg border ${style.border} ${style.bg} ${
        isWorking ? `${style.glow} animate-pulse-yellow` :
          isSuccess ? `${style.glow} animate-success-flash` :
            isFailed ? `${style.glow} animate-error-shake` :
              ''
      } ${node.showHistory ? 'cursor-pointer hover:scale-[1.02]' : 'cursor-default'} transition-all duration-300 overflow-hidden`}
      title={`${node.label}Agent(共 ${runCount} 次跑动,${successCount} 次成功)`}
    >
      {/* 工作时的辐射光环 */}
      {isWorking && (
        <>
          <div className="absolute inset-0 rounded-lg border-2 border-yellow-400/30 animate-ping" style={{ animationDuration: '2s' }} />
          <div className="absolute -inset-1 rounded-lg border border-yellow-400/15 animate-pulse" />
        </>
      )}

      {/* 左侧色条 */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${style.bar} ${isWorking ? 'animate-pulse' : ''}`} />

      <div className="flex flex-col h-full px-2 py-1.5 pl-2.5">
        {/* 顶部:图标 + 名称 + 跑动次数 */}
        <div className="flex items-center justify-between mb-1">
          <Icon className={`w-4 h-4 shrink-0 ${
            isWorking ? 'text-yellow-200' :
              isSuccess ? 'text-green-200' :
                isFailed ? 'text-red-200' :
                  'text-slate-400'
          }`} />
          <span className={`text-[10px] font-mono px-1 rounded ${
            runCount > 0 ? style.text : 'text-slate-600'
          }`}>
            {runCount}
          </span>
        </div>

        {/* 中部:Agent 名称 + 状态 */}
        <div className="flex-1 flex flex-col justify-center">
          <div className={`text-xs font-medium leading-tight ${
            isWorking ? 'text-yellow-100' :
              isSuccess ? 'text-green-100' :
                isFailed ? 'text-red-100' :
                  'text-slate-300'
          }`}>
            {node.label} <span className="text-[10px] opacity-70">Agent</span>
          </div>
          <div className={`text-[9px] mt-0.5 ${style.text} flex items-center gap-0.5`}>
            <StatusIcon className={`w-2.5 h-2.5 ${style.spin ? 'animate-spin' : ''}`} />
            <span className="truncate">{stateLabel}</span>
          </div>
        </div>

        {/* 底部:副标 */}
        <div className="text-[9px] text-slate-500 truncate">
          {node.sublabel}
        </div>
      </div>
    </button>
  )
}

export function AgentStatusRow() {
  const agents = useMeetingStore(s => s.agents)
  const moduleAgentHistory = useMeetingStore(s => s.moduleAgentHistory)
  const currentVersion = useMeetingStore(s => s.currentVersion)
  const versionHistory = useMeetingStore(s => s.versionHistory)
  const [now, setNow] = useState(Date.now())
  const [historyModal, setHistoryModal] = useState<AgentType | null>(null)
  // ★ 版本号 bump 闪动:每次版本变化高亮 1.5s
  const [versionFlash, setVersionFlash] = useState(false)
  const lastVersion = useRef(currentVersion)

  useEffect(() => {
    if (currentVersion !== lastVersion.current) {
      lastVersion.current = currentVersion
      setVersionFlash(true)
      const t = setTimeout(() => { setVersionFlash(false) }, 1500)
      return () => { clearTimeout(t) }
    }
  }, [currentVersion])

  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [])

  // 计算每个智能体的跑动次数
  const agentRunCounts = useMemo(() => {
    const counts: Record<string, { total: number; success: number; failed: number; working: number }> = {}
    for (const runs of moduleAgentHistory.values()) {
      for (const r of runs) {
        const c = counts[r.agent] ??= { total: 0, success: 0, failed: 0, working: 0 }
        c.total++
        if (r.status === 'success') counts[r.agent].success++
        else if (r.status === 'failed') counts[r.agent].failed++
        else if (r.status === 'working') counts[r.agent].working++
      }
    }
    return counts
  }, [moduleAgentHistory])

  // 全局统计
  const globalStats = useMemo(() => {
    let total = 0, success = 0, failed = 0, working = 0
    for (const c of Object.values(agentRunCounts)) {
      total += c.total
      success += c.success
      failed += c.failed
      working += c.working
    }
    return { total, success, failed, working }
  }, [agentRunCounts])

  // 最近一次版本 bump 的文件
  const lastBump = versionHistory.length > 0 ? versionHistory[versionHistory.length - 1] : undefined

  return (
    <>
      {/* 自定义动画 keyframes */}
      <style>{`
        @keyframes success-flash {
          0%, 100% { box-shadow: 0 0 20px rgba(34,197,94,0.6); }
          50% { box-shadow: 0 0 35px rgba(34,197,94,0.9), 0 0 50px rgba(34,197,94,0.4); }
        }
        @keyframes error-shake {
          0%, 100% { transform: translateX(0) scale(1); }
          20%, 80% { transform: translateX(-2px) scale(1); }
          40%, 60% { transform: translateX(2px) scale(1); }
        }
        @keyframes pulse-yellow {
          0%, 100% { box-shadow: 0 0 24px rgba(234,179,8,0.7), 0 0 40px rgba(234,179,8,0.4); }
          50% { box-shadow: 0 0 30px rgba(234,179,8,0.9), 0 0 50px rgba(234,179,8,0.6); }
        }
        @keyframes flow-line {
          0% { background-position: -100% 0; }
          100% { background-position: 100% 0; }
        }
        @keyframes cluster-pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        @keyframes version-flash {
          0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(168,85,247,0.7); }
          30% { transform: scale(1.3); box-shadow: 0 0 24px 8px rgba(168,85,247,0.6); }
          100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(168,85,247,0); }
        }
        .animate-success-flash { animation: success-flash 2s ease-in-out infinite; }
        .animate-error-shake { animation: error-shake 0.6s ease-in-out; }
        .animate-pulse-yellow { animation: pulse-yellow 1.5s ease-in-out infinite; }
        .animate-flow-line { background-size: 200% 100%; animation: flow-line 2s linear infinite; }
        .animate-cluster-pulse { animation: cluster-pulse 1.5s ease-in-out infinite; }
        .animate-version-flash { animation: version-flash 1.5s ease-out; }
      `}</style>

      {/* 整体容器:横向卡片网格,顶部全局数字,底部流光条 */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {/* 顶部全局统计 + 版本号 */}
        <div className="flex items-center gap-3 px-3 py-1 border-b border-slate-800/60 shrink-0">
          <span className="text-xs text-slate-500 font-medium">智能体集群</span>
          <div className="flex items-center gap-1 text-[10px]">
            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
              跑动 {globalStats.total}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-green-900/40 text-green-300 font-mono">
              ✓ {globalStats.success}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-red-900/40 text-red-300 font-mono">
              ✗ {globalStats.failed}
            </span>
            {globalStats.working > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-yellow-900/40 text-yellow-300 font-mono animate-cluster-pulse">
                ⏳ {globalStats.working}
              </span>
            )}
          </div>

          {/* ★ 版本号徽章(用户最关心的"我干了多少") */}
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[9px] text-slate-500 truncate max-w-[140px]" title={lastBump ? lastBump.files.join(', ') : ''}>
              {lastBump ? lastBump.files[0]?.split('/').pop() : ''}
              {lastBump && lastBump.files.length > 1 ? ` +${lastBump.files.length - 1}` : ''}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono border ${
                versionFlash
                  ? 'border-purple-400 text-purple-200 bg-purple-900/60 animate-version-flash'
                  : 'border-slate-700 text-slate-300 bg-slate-800/60'
              }`}
              title={`每次代码改动自动 +1,当前共 ${currentVersion} 次`}
            >
              v{currentVersion}
            </span>
          </div>
        </div>

        {/* 6 个 Agent 卡片网格 - 横向铺开,自适应宽度 */}
        <div className="flex-1 grid grid-cols-6 gap-2 p-2 min-h-0 min-w-0">
          {AGENT_CLUSTER.map((node) => {
            const storeKey = agentTypeToStoreKey(node.type)
            const status = agents[storeKey]
            const effectiveState: AgentState = (() => {
              if (!status) return 'idle'
              if (status.state === 'idle' || status.state === 'working') return status.state
              if (now - status.updatedAt > IDLE_TIMEOUT_MS) return 'idle'
              return status.state
            })()

            const counts = agentRunCounts[node.type] ?? { total: 0, success: 0, failed: 0, working: 0 }

            return (
              <AgentCard
                key={node.type}
                node={node}
                state={effectiveState}
                runCount={counts.total}
                successCount={counts.success}
                onClick={() => { if (node.showHistory) setHistoryModal(node.type) }}
              />
            )
          })}
        </div>

        {/* 底部流光条(集群整体活跃度可视化) */}
        <div className="relative h-1 bg-slate-900/60 overflow-hidden shrink-0">
          {globalStats.working > 0 && (
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-yellow-400 to-transparent animate-flow-line" />
          )}
          {globalStats.working === 0 && globalStats.success > 0 && (
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-green-400 to-transparent animate-flow-line" />
          )}
        </div>
      </div>

      {/* 历史弹窗 */}
      {historyModal && (
        <AgentHistoryModal
          agentType={historyModal}
          onClose={() => { setHistoryModal(null) }}
        />
      )}
    </>
  )
}
