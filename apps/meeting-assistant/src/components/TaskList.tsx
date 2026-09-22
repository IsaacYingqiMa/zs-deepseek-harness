/**
 * 任务清单 - 关注任务进度
 */
import { useState } from 'react'
import { ChevronDown, ChevronRight, CheckCircle2, AlertCircle, XCircle, Loader2, ListChecks, Wrench, GitBranch, Pause, Brain } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useMeetingStore } from '../store'
import { STATUS_LABELS, INTENT_LABELS, SPEAKER_COLORS, SPEAKER_LABELS } from '../types'
import type { TaskSummary } from '../types'
import { ExecutionDetail } from './ExecutionDetail'

const EMPTY_STEPS: never[] = []

/** 任务进度阶段 */
const PROGRESS_STEPS = [
  { status: 'detected',   label: '识别' },
  { status: 'analyzing',  label: '评估' },
  { status: 'confirmed',  label: '确认' },
  { status: 'executing',  label: '执行' },
  { status: 'completed',  label: '完成' },
]

/** 任务列表排序权重(executing 最前,superseded 最后) */
const STATUS_SORT_ORDER: Record<string, number> = {
  executing: 0, analyzing: 1, confirmed: 2, deferred: 3, detected: 4,
  completed: 5, failed: 6, rejected: 7, superseded: 8,
}

function statusOrder(status: string): number {
  return STATUS_SORT_ORDER[status] ?? 99
}

const PROGRESS_INDEX: Record<string, number> = {
  detected: 0,
  deferred: 0,
  rejected: -1,
  superseded: -1,
  analyzing: 1,
  confirmed: 2,
  executing: 3,
  completed: 4,
  failed: 3,
}

export function TaskList() {
  const tasks = useMeetingStore(s => s.tasks)
  const queueState = useMeetingStore(s => s.queueState)
  const taskList = Array.from(tasks.values()).sort((a, b) =>
    statusOrder(a.status) - statusOrder(b.status))

  const counts = {
    active: taskList.filter(t => ['detected', 'analyzing', 'confirmed', 'executing'].includes(t.status)).length,
    completed: taskList.filter(t => t.status === 'completed').length,
    rejected: taskList.filter(t => t.status === 'rejected').length,
  }

  return (
    <div className="h-full flex flex-col bg-slate-950">
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 border-b border-slate-800 px-3 py-2.5 text-sm font-medium text-slate-200 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-blue-400" />
          <span>任务清单</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">{taskList.length}</span>
          {counts.active > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/60 text-blue-300 border border-blue-800">
              进行中 {counts.active}
            </span>
          )}
          {counts.completed > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/40 text-green-400">
              ✓ {counts.completed}
            </span>
          )}
          {counts.rejected > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-400">
              ✗ {counts.rejected}
            </span>
          )}
        </div>
        {queueState.current && (
          <span className="text-xs px-2 py-0.5 rounded bg-purple-900/60 text-purple-300 border border-purple-800 flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            执行:{queueState.current.id.slice(0, 6)}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {taskList.length === 0 ? (
          <div className="text-center text-slate-600 text-xs py-16">
            <ListChecks className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <div>AI 还没有识别到需求</div>
            <div className="mt-1 text-slate-700">开始录音或手动输入,AI 会持续监听</div>
          </div>
        ) : (
          taskList.map(task => <TaskCard key={task.id} task={task} />)
        )}
      </div>
    </div>
  )
}

function TaskCard({ task }: { task: TaskSummary }) {
  const [expanded, setExpanded] = useState(false)
  const codingSteps = useMeetingStore(
    useShallow(s => s.codingSteps.get(task.id) ?? EMPTY_STEPS),
  )

  const stepIndex = PROGRESS_INDEX[task.status] ?? 0
  const isRejected = task.status === 'rejected'
  const isSuperseded = task.status === 'superseded'
  const isExecuting = task.status === 'executing'

  return (
    <div className={`bg-slate-900 border rounded-lg overflow-hidden shadow-sm transition-colors ${
      isExecuting ? 'border-blue-700/60' :
        isRejected ? 'border-red-900/50' :
          isSuperseded ? 'border-slate-800 opacity-60' :
            'border-slate-800 hover:border-slate-700'
    }`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 flex items-start gap-3 hover:bg-slate-800/40 text-left transition-colors"
      >
        {expanded
          ? <ChevronDown className="w-4 h-4 mt-0.5 shrink-0 text-slate-500" />
          : <ChevronRight className="w-4 h-4 mt-0.5 shrink-0 text-slate-500" />}

        {/* 状态徽章 */}
        <div className="shrink-0">
          <StatusBadge status={task.status} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs text-slate-400 font-medium">
              {STATUS_LABELS[task.status] || task.status}
            </span>
            <span className="text-xs text-slate-600">·</span>
            <span className="text-xs text-slate-500">{INTENT_LABELS[task.intent]}</span>
            {task.speakers.length > 0 && (
              <>
                <span className="text-xs text-slate-600">·</span>
                {task.speakers.map(s => (
                  <span key={s} className={`text-xs ${SPEAKER_COLORS[s]}`}>
                    {SPEAKER_LABELS[s]}
                  </span>
                ))}
              </>
            )}
          </div>
          <div className={`text-sm break-words leading-snug ${
            isSuperseded ? 'text-slate-500 line-through' : 'text-slate-100'
          }`}>
            {task.interpreted}
          </div>

          {/* 关系标记 */}
          {task.relations?.supersededBy && (
            <div className="text-xs text-purple-400 mt-1 flex items-center gap-1">
              <GitBranch className="w-3 h-3" />
              被新需求取代:#{task.relations.supersededBy.slice(0, 6)}
            </div>
          )}
          {task.relations?.extends && (
            <div className="text-xs text-cyan-400 mt-1 flex items-center gap-1">
              <GitBranch className="w-3 h-3" />
              扩展:#{task.relations.extends.slice(0, 6)}
            </div>
          )}

          {/* 进度条(只对进行中的任务显示) */}
          {!isRejected && !isSuperseded && (
            <ProgressBar stepIndex={stepIndex} status={task.status} />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-800 p-3 space-y-3 bg-slate-950/40">
          {/* 拒绝原因 */}
          {task.rejectionReason && (
            <div className="text-xs bg-red-950/30 border border-red-900/50 rounded p-2">
              <span className="text-red-400 font-medium">拒绝原因:</span>
              <span className="text-slate-300 ml-1">{task.rejectionReason}</span>
            </div>
          )}

          {/* 改动的文件 */}
          {task.modifiedFiles && task.modifiedFiles.length > 0 && (
            <div>
              <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                <Wrench className="w-3 h-3" /> 改动的文件
              </div>
              {task.modifiedFiles.map(f => (
                <div key={f} className="font-mono text-green-400 text-xs truncate">
                  ✓ {f}
                </div>
              ))}
            </div>
          )}

          {/* 执行步骤(只在有执行日志时显示) */}
          {codingSteps.length > 0 && (
            <ExecutionDetail steps={codingSteps} />
          )}
        </div>
      )}
    </div>
  )
}

/** 任务进度条 */
function ProgressBar({ stepIndex, status }: { stepIndex: number; status: string }) {
  if (stepIndex < 0) return null

  return (
    <div className="mt-2 flex items-center gap-0.5">
      {PROGRESS_STEPS.map((step, i) => {
        const isDone = i < stepIndex || status === 'completed'
        const isCurrent = i === stepIndex && status !== 'completed'
        const isFailed = status === 'failed' && i === stepIndex

        return (
          <div key={step.status} className="flex items-center gap-0.5 flex-1">
            <div
              className={`h-1 flex-1 rounded-full transition-all ${
                isFailed ? 'bg-red-500' :
                  isDone ? 'bg-green-500' :
                    isCurrent ? status === 'executing' ? 'bg-blue-500 animate-pulse' : 'bg-blue-700/50' :
                      'bg-slate-800'
              }`}
            />
            {i < PROGRESS_STEPS.length - 1 && null}
          </div>
        )
      })}
    </div>
  )
}

/** 状态徽章(圆形颜色) */
function StatusBadge({ status }: { status: string }) {
  const iconMap: Record<string, { Icon: LucideIcon; color: string; bg: string; animate?: string }> = {
    detected:   { Icon: ListChecks, color: 'text-slate-300',  bg: 'bg-slate-700' },
    analyzing:  { Icon: Brain,      color: 'text-blue-300',   bg: 'bg-blue-900/60' },
    confirmed:  { Icon: CheckCircle2, color: 'text-cyan-300', bg: 'bg-cyan-900/60' },
    executing:  { Icon: Wrench,     color: 'text-blue-200',   bg: 'bg-blue-600', animate: 'animate-spin' },
    completed:  { Icon: CheckCircle2, color: 'text-green-300',bg: 'bg-green-900/60' },
    failed:     { Icon: AlertCircle, color: 'text-red-300',    bg: 'bg-red-900/60' },
    rejected:   { Icon: XCircle,    color: 'text-red-400',    bg: 'bg-red-900/40' },
    deferred:   { Icon: Pause,      color: 'text-amber-300',  bg: 'bg-amber-900/40' },
    superseded:{ Icon: GitBranch,  color: 'text-slate-500',   bg: 'bg-slate-800' },
  }
  const cfg = iconMap[status] || iconMap.detected
  const { Icon, color, bg, animate } = cfg
  return (
    <div className={`w-7 h-7 rounded-full ${bg} flex items-center justify-center ${color} flex-shrink-0`}>
      <Icon className={`w-4 h-4 ${animate || ''}`} />
    </div>
  )
}
