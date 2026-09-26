/**
 * AI 决策流 —— 自主判断视图
 *
 * 结构(从上到下):
 *   1. Header: 标题 + 5 个核心统计(StatsBarInline)
 *   2. Body:
 *       - AsrModuleCard 列表(每个 module = 一次 judge 的完整 ASR 输入 + 创建的 task)
 *       - RequirementSection(3 分组汇总:可执行 / 拒绝 / 总提取详情)
 *
 * 设计原则:
 *   - 只展示"成功提取到需求"的输入(unclear / incomplete / rejected-without-task 不展示)
 *   - rejected task 展示拒绝原因
 *   - module 内 task 状态实时同步 task/* 事件
 */
import { useShallow } from 'zustand/react/shallow'
import { Brain, Wand2 } from 'lucide-react'
import { useMeetingStore } from '../store'
import { AsrModuleCard } from './AsrModuleCard'
import { RequirementSection } from './RequirementSection'
import { StatsBarInline } from './StatsBar'
import { PanelHeader } from './PanelHeader'

export function AiReasoningStream() {
  const modules = useMeetingStore(useShallow(s => s.modules))

  return (
    <div className="h-full flex flex-col bg-slate-950/60 relative">
      {/* Header: 标题 + 5 个核心统计 */}
      <PanelHeader icon={Brain} title="AI 决策流" subtitle="自主判断">
        <StatsBarInline />
      </PanelHeader>

      {/* Body: 顶部 RequirementSection(汇总) + 下面 modules 详情 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {modules.length === 0 ? (
          <div className="text-slate-600 px-2 py-8 text-center">
            <Wand2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <div className="text-xs">等待 AI 提取需求...</div>
            <div className="text-[10px] text-slate-700 mt-1">
              开始说话,这里会显示 AI 提取到的需求 + 判断过程
            </div>
          </div>
        ) : (
          <>
            {/* 提取到的需求汇总(顶部,一眼看到全部) */}
            <RequirementSection />

            {/* ASR 输入模块列表(详情:每次 judge 的完整对话 + 判断过程) */}
            {modules.slice(-15).map(m => (
              <AsrModuleCard key={m.judgeId} module={m} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
