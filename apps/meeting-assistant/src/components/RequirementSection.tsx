/**
 * RequirementSection —— 提取到的需求汇总
 *
 * 设计原则:严格遵循"决策层只管判断"原则。
 *   - 分类按 LLM 可行性评估结果(feasible / infeasible)切分
 *   - 跟 task 的执行状态(confimed/executing/completed/failed 等)脱钩
 *   - 一个 feasible 的 task 即使 dsh 执行失败,在决策层仍然算"可开发"
 *
 * 结构:
 *   - Header: 3 个分类的总览(总提取 / 可开发 / 非可开发)
 *   - Body: 3 个分组
 *       - 可开发:LLM 可行性 = feasible
 *       - 非可开发:LLM 可行性 = infeasible
 *       - 总提取详情:全部 module.tasks(默认折叠)
 *
 * 数据来源:遍历 store.modules,聚合每个 task 的 feasibility 字段
 */
import { useState, useMemo } from 'react'
import {
  ChevronDown, ChevronRight, Check, X, Target, ListChecks,
} from 'lucide-react'
import { useMeetingStore } from '../store'
import { INTENT_LABELS } from '../types'
import type { ModuleTask } from '../types'

const INTENT_LABEL_BY_INTENT = INTENT_LABELS

/**
 * 判断 task 在决策层是否可开发(基于 feasibility,不是 task 状态)
 *
 * 决策层组合公式:
 *   feasible = (
 *     feasibility.technical === 'feasible' &&
 *     feasibility.inWhitelist === true &&
 *     feasibility.riskLevel !== 'high' &&
 *     feasibility.workload !== 'large'
 *   )
 */
function isLlmFeasible(task: ModuleTask): boolean {
  const f = task.feasibility
  if (!f) return false  // 没评估过(理论上不应到这里)
  return (
    f.technical === 'feasible' &&
    f.inWhitelist &&
    f.riskLevel !== 'high' &&
    f.workload !== 'large'
  )
}

export function RequirementSection() {
  const modules = useMeetingStore(s => s.modules)

  // 聚合所有 module.tasks
  const allTasks = useMemo<ModuleTask[]>(() => {
    const map = new Map<string, ModuleTask>()
    for (const m of modules) {
      for (const t of m.tasks) {
        if (!map.has(t.taskId)) map.set(t.taskId, t)
      }
    }
    return Array.from(map.values())
  }, [modules])

  // ★ 按 LLM 可行性评估分类(决策层视角)
  const feasibleTasks = allTasks.filter(t => isLlmFeasible(t))
  const infeasibleTasks = allTasks.filter(t => !isLlmFeasible(t))
  const totalCount = allTasks.length

  if (totalCount === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-[10px] text-slate-600 text-center">
        暂无提取到的需求(AI 会持续监听 ASR 输入)
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-3 bg-gradient-to-r from-slate-900 to-slate-800 border-b border-slate-800">
        <ListChecks className="w-4 h-4 text-blue-400" />
        <span className="text-xs font-medium text-slate-200">提取到的需求</span>
        <div className="ml-auto flex items-center gap-2 text-[10px]">
          <Badge color="blue" label="总提取" value={totalCount} />
          <Badge color="green" label="可开发" value={feasibleTasks.length} />
          <Badge color="orange" label="非可开发" value={infeasibleTasks.length} />
        </div>
      </div>

      <div className="p-2 space-y-2">
        <RequirementGroup
          title="可开发"
          color="green"
          tasks={feasibleTasks}
          defaultOpen={true}
        />
        <RequirementGroup
          title="非可开发"
          color="orange"
          tasks={infeasibleTasks}
          defaultOpen={false}
        />
        <RequirementGroup
          title="总提取详情"
          color="blue"
          tasks={allTasks}
          defaultOpen={false}
        />
      </div>
    </div>
  )
}

/** 顶部小徽章 */
function Badge({ color, label, value }: { color: string; label: string; value: number }) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-900/40 text-blue-300 border-blue-800/50',
    green: 'bg-green-900/40 text-green-300 border-green-800/50',
    red: 'bg-red-900/40 text-red-300 border-red-800/50',
    orange: 'bg-orange-900/40 text-orange-300 border-orange-800/50',
  }
  return (
    <span className={`px-1.5 py-0.5 rounded border ${colorMap[color] || colorMap.blue}`}>
      {label} <span className="font-bold tabular-nums ml-0.5">{value}</span>
    </span>
  )
}

/** 一个分组(可折叠) */
function RequirementGroup({
  title,
  color,
  tasks,
  defaultOpen,
}: {
  title: string
  color: string
  tasks: ModuleTask[]
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  const colorMap: Record<string, { text: string; border: string; bg: string }> = {
    blue:   { text: 'text-blue-300',   border: 'border-blue-900/60',   bg: 'bg-blue-900/20' },
    green:  { text: 'text-green-300',  border: 'border-green-900/60',  bg: 'bg-green-900/20' },
    red:    { text: 'text-red-300',    border: 'border-red-900/60',    bg: 'bg-red-900/20' },
    orange: { text: 'text-orange-300', border: 'border-orange-900/60', bg: 'bg-orange-900/20' },
  }
  const c = colorMap[color] ?? colorMap.blue

  if (tasks.length === 0) {
    return null
  }

  return (
    <div className={`rounded border ${c.border} ${c.bg}/40 overflow-hidden`}>
      <button
        onClick={() => { setOpen(!open) }}
        className="w-full px-2 py-1.5 flex items-center gap-1.5 hover:bg-slate-800/30 text-left"
      >
        {open
          ? <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" />
          : <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />
        }
        <span className={`text-[10px] font-medium ${c.text}`}>{title}</span>
        <span className="text-[10px] text-slate-500">({tasks.length})</span>
      </button>

      {open && (
        <div className="border-t border-slate-800/50 p-1.5 space-y-1">
          {tasks.map(task => (
            <RequirementRow key={task.taskId} task={task} />
          ))}
        </div>
      )}
    </div>
  )
}

/** 单行汇总 */
function RequirementRow({ task }: { task: ModuleTask }) {
  // ★ 决策层判断:基于 LLM 可行性评估,不是 task 状态
  const isLlmInfeasible = !isLlmFeasible(task)
  const intentLabel = INTENT_LABEL_BY_INTENT[task.intent] || task.intent

  return (
    <div className={`flex items-start gap-2 px-2 py-1 rounded text-[11px] hover:bg-slate-800/40 transition-colors ${
      isLlmInfeasible ? 'opacity-70' : ''
    }`}>
      {isLlmInfeasible
        ? <X className="w-3 h-3 text-orange-400 shrink-0 mt-0.5" />
        : <Check className="w-3 h-3 text-green-400 shrink-0 mt-0.5" />
      }
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`font-medium ${isLlmInfeasible ? 'text-slate-400 line-through' : 'text-slate-200'}`}>
            #{task.taskId.slice(0, 6)}
          </span>
          <span className="text-[10px] text-purple-600">{intentLabel}</span>
          {task.target && (
            <span className="flex items-center gap-0.5 text-[10px] text-amber-300/80">
              <Target className="w-2.5 h-2.5" />
              {task.target}
            </span>
          )}
          <span className={`ml-auto text-[10px] px-1 rounded ${
            isLlmInfeasible
              ? 'bg-orange-900/40 text-orange-300'
              : 'bg-green-900/40 text-green-300'
          }`}>
            {task.currentStatus}
          </span>
        </div>
        {isLlmInfeasible && task.feasibility?.reasoning && (
          <div className="text-[10px] text-orange-400/70 italic mt-0.5">
            {task.feasibility.reasoning}
          </div>
        )}
      </div>
    </div>
  )
}
