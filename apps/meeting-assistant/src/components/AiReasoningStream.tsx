/**
 * AI 决策流(底部)—— 替换旧的纯文本流
 *
 * 展示 AI 在每条输入上做了什么判断
 */
import { useShallow } from 'zustand/react/shallow'
import { Brain, Wand2 } from 'lucide-react'
import { useMeetingStore } from '../store'
import { DecisionCard } from './DecisionCard'

export function AiReasoningStream() {
  const cards = useMeetingStore(useShallow(s => s.decisionCards))

  return (
    <div className="h-full flex flex-col bg-slate-950/60">
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 border-b border-slate-800 px-3 py-2 text-sm font-medium text-slate-200 flex items-center gap-2">
        <Brain className="w-4 h-4 text-blue-400" />
        <span>AI 决策流</span>
        <span className="text-xs text-slate-500 ml-1">· 自主判断</span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 ml-auto">
          {cards.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {cards.length === 0 ? (
          <div className="text-slate-600 px-2 py-8 text-center">
            <Wand2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <div className="text-xs">等待 AI 判断...</div>
            <div className="text-[10px] text-slate-700 mt-1">开始输入,这里会显示每一步决策</div>
          </div>
        ) : (
          cards.slice(-30).map((card, i) => (
            <DecisionCard key={i} card={card} />
          ))
        )}
      </div>
    </div>
  )
}
