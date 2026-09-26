/**
 * PanelHeader —— 三栏统一头部
 *
 * 三个内容面板(实时转写 / AI 决策流 / 任务清单)用统一的样式:
 *   - 高度:py-2 + h-9 ≈ 36px
 *   - 背景:slate-900 → slate-800 渐变
 *   - 边框:底部 border-slate-800
 *   - 左侧:图标 + 标题
 *   - 右侧:可选徽章(children)
 *
 * 用法:
 *   <PanelHeader icon={Brain} title="AI 决策流">
 *     <span>5 个统计</span>
 *   </PanelHeader>
 */
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface PanelHeaderProps {
  /** 左侧图标(蓝色) */
  icon: LucideIcon
  /** 主标题 */
  title: string
  /** 副标题(可选,小字灰) */
  subtitle?: string
  /** 右侧内容(徽章/统计等) */
  children?: ReactNode
}

export function PanelHeader({ icon: Icon, title, subtitle, children }: PanelHeaderProps) {
  return (
    <div className="bg-gradient-to-r from-slate-900 to-slate-800 border-b border-slate-800 px-3 py-1.5 flex items-center gap-2 shrink-0 h-9">
      <Icon className="w-4 h-4 text-blue-400 shrink-0" />
      <span className="text-sm font-medium text-slate-200">{title}</span>
      {subtitle && (
        <span className="text-[11px] text-slate-500">· {subtitle}</span>
      )}
      {children && (
        <div className="ml-auto flex items-center gap-1.5 min-w-0">
          {children}
        </div>
      )}
    </div>
  )
}
