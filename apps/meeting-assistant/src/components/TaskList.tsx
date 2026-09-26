/**
 * 任务清单 - 关注任务进度
 */
import { useState } from 'react'
import {
  ChevronDown, ChevronRight, CheckCircle2, AlertCircle, XCircle, Loader2,
  ListChecks, Wrench, GitBranch, Pause, Brain, FileText, Zap, Flag, Circle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useMeetingStore } from '../store'
import { STATUS_LABELS, INTENT_LABELS, SPEAKER_COLORS, SPEAKER_LABELS } from '../types'
import type { TaskSummary, TaskPhase } from '../types'
import { ExecutionDetail } from './ExecutionDetail'
import { PanelHeader } from './PanelHeader'

const EMPTY_STEPS: never[] = []

/** 任务进度阶段 —— 已废弃,改用 TaskList 内的 ProgressBar(基于 4 阶段 phase) */
const _PROGRESS_STEPS_LEGACY = [
  { status: 'detected',   label: '识别' },
  { status: 'analyzing',  label: '评估' },
  { status: 'confirmed',  label: '确认' },
  { status: 'executing',  label: '执行' },
  { status: 'completed',  label: '完成' },
]
void _PROGRESS_STEPS_LEGACY  // 保留供迁移使用

/** 任务列表排序权重(executing 最前,superseded 最后) */
const STATUS_SORT_ORDER: Record<string, number> = {
  executing: 0, analyzing: 1, confirmed: 2, deferred: 3, detected: 4,
  completed: 5, failed: 6, rejected: 7, superseded: 8,
}

function statusOrder(status: string): number {
  return STATUS_SORT_ORDER[status] ?? 99
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
      <PanelHeader icon={ListChecks} title="任务清单">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 font-mono">
          {taskList.length}
        </span>
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
        {queueState.current && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/60 text-purple-300 border border-purple-800 flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            执行:{queueState.current.id.slice(0, 6)}
          </span>
        )}
      </PanelHeader>
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
        onClick={() => { setExpanded(!expanded) }}
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

          {/* 4 阶段进度条(对所有 task 都显示,异常状态灰色) */}
          <ProgressBar taskId={task.id} status={task.status} />
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

/**
 * 任务阶段 —— 4 阶段简化版,对应 zsspec 流程
 *
 * 链路:brain(需求) → spec(规格) → apply(开发) → done(验收)
 */
const PHASE_STEPS: Array<{
  phase: TaskPhase
  label: string
  Icon: LucideIcon
}> = [
  { phase: 'brain', label: '需求', Icon: Brain },
  { phase: 'spec',  label: '规格', Icon: FileText },
  { phase: 'apply', label: '开发', Icon: Zap },
  { phase: 'done',  label: '验收', Icon: Flag },
]

const PHASE_INDEX: Record<string, number> = {
  idle: -1,
  brain: 0,
  spec: 1,
  apply: 2,
  done: 3,
  failed: -1, // failed 时单独渲染(在当前位置显示 ✗)
}

const PHASE_LABEL: Record<string, string> = {
  idle: '空闲',
  brain: '需求分析中...',
  spec: '生成规格中...',
  apply: '开发+测试中...',
  done: '已完成 ✓',
  failed: '失败 ✗',
}

/** 4 阶段进度条 —— 根据 store.taskPhases[id] 渲染 */
function ProgressBar({ taskId, status }: { taskId: string; status: string }) {
  const phase = useMeetingStore(s => s.taskPhases.get(taskId) ?? 'idle')

  // 异常状态显示灰色进度条
  const isAbnormal = ['deferred', 'rejected', 'superseded'].includes(status)

  // 当前 phase 在 PHASE_STEPS 里的索引
  const currentIdx = PHASE_INDEX[phase]
  const isFailed = phase === 'failed'
  // ★ done 阶段:全绿 + 强发光(已完成 = 整条绿光带)
  const isDone = phase === 'done'

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center gap-0.5">
        {PHASE_STEPS.map((step, i) => {
          // 阶段状态判断
          let bgClass = 'bg-slate-800'
          if (isAbnormal) {
            bgClass = 'bg-slate-700'
          } else if (isDone) {
            // ★ 已完成:全阶段变绿 + 强发光
            bgClass = 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.7)]'
          } else if (isFailed) {
            // 失败:前面的成功,当前变红 + 强发光
            bgClass = i < currentIdx ? 'bg-green-500'
              : i === currentIdx ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]'
                : 'bg-slate-800'
          } else {
            // 当前阶段:更亮的蓝色 + animate-pulse + 强发光
            bgClass = i < currentIdx ? 'bg-green-500'
              : i === currentIdx
                ? 'bg-blue-400 animate-pulse shadow-[0_0_10px_rgba(96,165,250,0.8)]'
                : 'bg-slate-800'
          }

          return (
            <div key={step.phase} className="flex items-center gap-0.5 flex-1">
              <div
                className={`h-1 flex-1 rounded-full transition-all ${bgClass}`}
                title={`${step.label}${i === currentIdx ? '(当前)' : ''}`}
              />
            </div>
          )
        })}
      </div>

      {/* 阶段标签 + 当前状态文字 */}
      <div className="flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-2">
          {PHASE_STEPS.map((step, i) => {
            const isCurrent = !isAbnormal && !isFailed && !isDone && i === currentIdx
            const isStepDone = (!isAbnormal && !isFailed && (i < currentIdx || isDone))
            const isFailedHere = isFailed && i === currentIdx

            // ★ 当前阶段更亮 + 完成阶段强绿色
            const colorClass = isAbnormal ? 'text-slate-500'
              : isFailedHere ? 'text-red-400 font-bold animate-pulse'
                : isStepDone ? 'text-green-300 font-bold'   // 已完成:亮绿
                  : isCurrent ? 'text-blue-300 font-bold animate-pulse'  // 当前:亮蓝闪烁
                    : 'text-slate-600'

            const Icon2 = isAbnormal ? Circle
              : isFailedHere ? XCircle
                : isStepDone ? CheckCircle2
                  : step.Icon

            return (
              <span key={step.phase} className={`flex items-center gap-0.5 ${colorClass}`}>
                <Icon2 className={`w-2.5 h-2.5 ${isCurrent ? 'drop-shadow-[0_0_4px_rgba(96,165,250,0.8)]' : ''} ${isStepDone ? 'drop-shadow-[0_0_4px_rgba(34,197,94,0.6)]' : ''}`} />
                <span>{step.label}</span>
              </span>
            )
          })}
        </div>

        {/* 当前状态文字 */}
        {(currentIdx >= 0 || isFailed) && (
          <span className={`font-bold ${
            isDone ? 'text-green-300' :
              isFailed ? 'text-red-400' :
                'text-blue-300 animate-pulse'
          }`}>
            {PHASE_LABEL[phase] ?? ''}
          </span>
        )}
      </div>
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
  const cfg = iconMap[status] ?? iconMap.detected
  const { Icon, color, bg, animate } = cfg
  return (
    <div className={`w-7 h-7 rounded-full ${bg} flex items-center justify-center ${color} flex-shrink-0`}>
      <Icon className={`w-4 h-4 ${animate || ''}`} />
    </div>
  )
}
