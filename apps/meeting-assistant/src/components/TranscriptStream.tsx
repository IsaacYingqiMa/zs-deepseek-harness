/**
 * 实时转写流
 *
 * 显示策略:
 *  - 已完成的句子(commit 过):正常显示
 *  - 当前累积中的句子(pendingSentence):浅灰 + 光标,标记"正在听"
 */
import { useShallow } from 'zustand/react/shallow'
import { Mic, MessagesSquare } from 'lucide-react'
import { useMeetingStore } from '../store'
import { SPEAKER_COLORS, SPEAKER_LABELS } from '../types'
import { PanelHeader } from './PanelHeader'

export function TranscriptStream() {
  const chunks = useMeetingStore(useShallow(s => s.asrChunks))
  const pending = useMeetingStore(s => s.pendingSentence)
  const pendingSpeaker = useMeetingStore(s => s.pendingSpeaker)
  const totalCount = chunks.length + (pending ? 1 : 0)

  return (
    <div className="h-full flex flex-col bg-slate-950/40">
      <PanelHeader icon={Mic} title="实时转写" subtitle="原始 ASR 流">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 font-mono">
          {totalCount}
        </span>
        {pending && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/60 text-blue-300 border border-blue-800 animate-pulse">
            ● 收听中
          </span>
        )}
      </PanelHeader>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {chunks.length === 0 && !pending ? (
          <div className="text-center text-slate-600 text-xs py-8">
            <MessagesSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <div>等待 ASR 转写...</div>
          </div>
        ) : (
          <>
            {/* 已完成句子 */}
            {chunks.slice(-30).map(chunk => (
              <div key={chunk.id} className="flex gap-2 text-xs group hover:bg-slate-900/50 -mx-1 px-1 py-0.5 rounded transition-colors">
                <span className={`text-[10px] font-medium shrink-0 w-7 ${SPEAKER_COLORS[chunk.speaker]}`}>
                  {SPEAKER_LABELS[chunk.speaker]}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-slate-200 break-words leading-snug">
                    {chunk.text}
                  </div>
                </div>
              </div>
            ))}

            {/* 当前累积的流式句子(还没 isFinal) */}
            {pending && (
              <div className="flex gap-2 text-xs bg-slate-900/60 -mx-1 px-1 py-1 rounded border border-dashed border-slate-700">
                <span className={`text-[10px] font-medium shrink-0 w-7 ${SPEAKER_COLORS[pendingSpeaker as keyof typeof SPEAKER_COLORS] || 'text-slate-400'}`}>
                  <Mic className="w-3 h-3 inline animate-pulse" />
                </span>
                <div className="flex-1 min-w-0 text-slate-400 italic leading-snug">
                  {pending}
                  <span className="inline-block w-1.5 h-3 bg-blue-400 ml-0.5 animate-pulse"></span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
