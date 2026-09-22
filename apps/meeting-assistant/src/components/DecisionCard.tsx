/**
 * AI 决策卡片
 *
 * 展示 AI 在一次输入中怎么判断、为什么判断、做了什么决策
 *
 * 4 个阶段:
 *   1. input    - 接收 ASR 输入
 *   2. llm      - LLM 思考过程(每个意图)
 *   3. decision  - 决策:创建/驳回/关系处理
 *   4. rejected/unclear - 拒绝原因
 */
import {
  Brain,
  Check,
  X,
  HelpCircle,
  GitBranch,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react'
import type { DecisionCard as DecisionCardType } from './types'

const STAGE_STYLES = {
  input: { color: 'text-blue-400', bg: 'bg-blue-900/30', border: 'border-blue-900', icon: Brain },
  llm: { color: 'text-purple-400', bg: 'bg-purple-900/30', border: 'border-purple-900', icon: Brain },
  decision: { color: 'text-green-400', bg: 'bg-green-900/30', border: 'border-green-900', icon: Check },
  rejected: { color: 'text-red-400', bg: 'bg-red-900/30', border: 'border-red-900', icon: X },
  unclear: { color: 'text-amber-400', bg: 'bg-amber-900/30', border: 'border-amber-900', icon: HelpCircle },
}

const RELATION_LABELS: Record<string, string> = {
  supersedes: '⤵ 取代',
  extends: '→ 扩展',
  conflicts: '⚡ 冲突',
  rejects: '✗ 驳回',
}

export function DecisionCard({ card }: { card: DecisionCardType }) {
  const stage = card.stage
  const style = STAGE_STYLES[stage] || STAGE_STYLES.input
  const Icon = style.icon

  return (
    <div className={`rounded-lg border ${style.border} ${style.bg} p-3 text-xs space-y-1.5`}>
      {/* header */}
      <div className="flex items-center gap-1.5">
        <Icon className={`w-3.5 h-3.5 ${style.color}`} />
        <span className={`font-medium ${style.color}`}>
          {stage === 'input' && '接收输入'}
          {stage === 'llm' && 'LLM 思考'}
          {stage === 'decision' && '决策'}
          {stage === 'rejected' && '拒绝'}
          {stage === 'unclear' && '不清晰'}
        </span>
        <span className="text-slate-600 ml-auto font-mono">
          {new Date(card.at).toLocaleTimeString()}
        </span>
      </div>

      {/* input stage */}
      {stage === 'input' && (
        <div>
          <div className="text-slate-500 text-[10px]">ASR 转写:</div>
          <div className="text-slate-300">"{card.text}"</div>
          {card.recentTasksCount !== undefined && (
            <div className="text-slate-600 text-[10px] mt-1">
              📚 参考 {card.recentTasksCount} 个历史 task 做关联
            </div>
          )}
        </div>
      )}

      {/* llm stage */}
      {stage === 'llm' && (
        <div className="space-y-1">
          {card.intents?.length === 0 ? (
            <div className="text-slate-500">LLM 没识别到任何意图,可能用规则兜底</div>
          ) : (
            card.intents?.map((intent, i) => (
              <div key={i} className="bg-slate-950/50 rounded p-2 space-y-0.5">
                <div className="flex items-center gap-1">
                  <span className="text-purple-300">{intent.intent}</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-400">confidence={((intent.confidence || 0) * 100).toFixed(0)}%</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-400">target=<span className="text-amber-300">{intent.target || 'null'}</span></span>
                </div>
                <div className="text-slate-300 leading-relaxed">
                  💭 {intent.reasoning}
                </div>
                {intent.relationTo?.taskId && (
                  <div className="text-blue-400 text-[10px] flex items-center gap-1">
                    <GitBranch className="w-3 h-3" />
                    {RELATION_LABELS[intent.relationTo.type || '']} #{intent.relationTo.taskId.slice(0, 6)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* decision stage */}
      {stage === 'decision' && (
        <div>
          {card.action === 'created' && (
            <div className="space-y-1">
              <div className="text-green-400">
                ✓ 创建任务 #{card.taskId?.slice(0, 6)}
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
                <div className="text-slate-500">意图:<span className="text-slate-300">{card.intent}</span></div>
                <div className="text-slate-500">置信度:
                  <span className={card.confidence && card.confidence >= 0.7 ? 'text-green-400' : 'text-amber-400'}>
                    {card.confidence ? `${(card.confidence * 100).toFixed(0)}%` : '-'}
                  </span>
                </div>
                <div className="text-slate-500 col-span-2">
                  target:<span className="text-amber-300">{card.target || '⚠️ null'}</span>
                </div>
              </div>
              <div className="text-slate-400 italic text-[10px]">
                💭 {card.reasoning}
              </div>
              {card.relationTo?.taskId && (
                <div className="text-blue-400 text-[10px] flex items-center gap-1">
                  <ChevronRight className="w-3 h-3" />
                  关系:{RELATION_LABELS[card.relationTo.type || '']}
                  #{card.relationTo.taskId.slice(0, 6)}
                </div>
              )}
            </div>
          )}
          {card.action === 'rejected-existing' && (
            <div className="text-red-400">
              ✗ 驳回 #{card.taskId?.slice(0, 6)}
              <div className="text-slate-400 italic text-[10px] mt-0.5">💭 {card.reasoning}</div>
            </div>
          )}
        </div>
      )}

      {/* rejected / unclear */}
      {(stage === 'rejected' || stage === 'unclear') && (
        <div className="text-slate-400">
          <AlertTriangle className="w-3 h-3 inline mr-1" />
          {card.reason || card.note || '原因未知'}
          {card.rawText && (
            <div className="text-[10px] text-slate-600 mt-0.5">
              "{card.rawText}"
            </div>
          )}
        </div>
      )}
    </div>
  )
}
