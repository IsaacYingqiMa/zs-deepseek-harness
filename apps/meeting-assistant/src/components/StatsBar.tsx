/**
 * StatsBar —— 紧凑 inline 版(5 个核心数字)
 *
 * 设计目标:
 *   - 嵌在 AiReasoningStream 的 header 里,不再独立占一行
 *   - 5 个核心数字(全部来自 LLM 决策层):
 *       总决策 = requirements + chitchat
 *       需求   = feasible + infeasible
 *       非需求 = chitchat(闲聊/不清晰/截断)
 *       可开发 = LLM 评估为可行
 *       非可开发 = LLM 评估为不可行
 *
 *   数学关系(决策层内部守恒):
 *     totalIntents = requirements + chitchat
 *     requirements = feasible + infeasible
 *
 *   - 每个数字 hover 显示 hint + version 标签
 *   - 颜色按"流程阶段"区分
 */
import { useState } from 'react'
import { useMeetingStore } from '../store'
import type { DecisionStats } from '../types'
import { ListChecks, Target, Activity, CheckCircle2, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface StatItem {
  key: string
  label: string
  value: number
  icon: LucideIcon
  color: string
  /** 数字为 0 时是否仍展示(总决策类 alwaysShow) */
  alwaysShow?: boolean
  hint?: string
}

function deriveItems(stats: DecisionStats | null): StatItem[] {
  if (!stats) {
    return [
      {
        key: 'total', label: '总决策', value: 0,
        icon: ListChecks, color: 'text-slate-400', alwaysShow: true,
        hint: '总决策任务数 = 需求数 + 非需求数',
      },
    ]
  }

  return [
    {
      key: 'total', label: '总决策', value: stats.totalIntents,
      icon: ListChecks, color: 'text-slate-300', alwaysShow: true,
      hint: `总决策 = 需求(${stats.requirements}) + 非需求(${stats.chitchat})`,
    },
    {
      key: 'req', label: '需求', value: stats.requirements,
      icon: Target, color: 'text-blue-300',
      hint: `LLM 识别为产品需求 = 可开发(${stats.feasible}) + 非可开发(${stats.infeasible})`,
    },
    {
      key: 'chit', label: '非需求', value: stats.chitchat,
      icon: Activity, color: 'text-slate-500',
      hint: '非产品需求意图(discussion / unclear / 截断)',
    },
    {
      key: 'feasible', label: '可开发', value: stats.feasible,
      icon: CheckCircle2, color: 'text-green-400',
      hint: 'LLM 可行性评估:feasible + inWhitelist + risk!="high" + workload!="large"',
    },
    {
      key: 'infeasible', label: '非可开发', value: stats.infeasible,
      icon: XCircle, color: 'text-orange-400',
      hint: 'LLM 可行性评估:feasible=infeasible 或 !inWhitelist 或 risk="high"',
    },
  ]
}

function filterItems(items: StatItem[]): StatItem[] {
  return items.filter(i => i.alwaysShow || i.value > 0)
}

/**
 * 紧凑 inline 容器(由 AiReasoningStream 的 header 渲染,不需要自己的 div)
 */
export function StatsBarInline() {
  const stats = useMeetingStore(s => s.stats)
  const items = filterItems(deriveItems(stats))
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)

  return (
    <div className="flex items-center gap-1">
      {items.map((item) => {
        const { key, label, value, icon: Icon, color } = item
        const active = hoveredKey === key
        return (
          <button
            key={key}
            type="button"
            onMouseEnter={() => { setHoveredKey(key) }}
            onMouseLeave={() => { setHoveredKey(null) }}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
              active ? 'bg-slate-800' : 'hover:bg-slate-800/60'
            }`}
          >
            <Icon className={`w-3 h-3 ${color}`} />
            <span className="text-[10px] text-slate-500 font-medium">{label}</span>
            <span className={`text-[11px] font-bold tabular-nums ${value === 0 ? 'text-slate-600' : 'text-slate-100'}`}>
              {value}
            </span>
          </button>
        )
      })}

      {stats && (
        <span className="ml-1 text-[9px] text-slate-600 font-mono">
          v{stats.version}
        </span>
      )}

      {/* Hint 浮层 */}
      {hoveredKey && (() => {
        const item = items.find(i => i.key === hoveredKey)
        if (!item?.hint) return null
        return (
          <div className="absolute top-full right-0 mt-1 z-50 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-[10px] text-slate-300 shadow-lg pointer-events-none max-w-md">
            <div className="text-slate-500 mb-0.5">{item.label}:</div>
            {item.hint}
          </div>
        )
      })()}
    </div>
  )
}

/**
 * 完整 StatsBar(独立横条版,保留备用)
 * 现在不被 import,但保留以防其他地方需要
 */
export function StatsBar() {
  return <StatsBarInline />
}
