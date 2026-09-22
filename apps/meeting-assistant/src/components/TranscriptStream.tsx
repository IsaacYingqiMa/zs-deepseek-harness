/**
 * 实时转写流
 *
 * 显示策略:
 *  - 已完成的句子(commit 过):正常显示
 *  - 当前累积中的句子(pendingSentence):浅灰 + 光标,标记"正在听"
 */
import { useShallow } from 'zustand/react/shallow'
import { MessagesSquare, Mic } from 'lucide-react'
import { useMeetingStore } from '../store'
import { SPEAKER_COLORS, SPEAKER_LABELS } from '../types'

export function TranscriptStream() {
  const chunks = useMeetingStore(useShallow(s => s.asrChunks))
  const pending = useMeetingStore(s => s.pendingSentence)
  const pendingSpeaker = useMeetingStore(s => s.pendingSpeaker)

  return (
    <div className="h-full flex flex-col bg-slate-950/40">
      <div className="bg-slate-900/80 border-b border-slate-800 px-3 py-2 text-sm font-medium text-slate-200 flex items-center gap-2">
        <MessagesSquare className="w-4 h-4 text-blue-400" />
        <span>实时转写</span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 ml-auto">
          {chunks.length + (pending ? 1 : 0)}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {chunks.length === 0 && !pending ? (
          <div className="text-center text-slate-600 text-xs py-16">
            <MessagesSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <div>等待 ASR 转写...</div>
            <div className="mt-1 text-slate-700">或使用下方手动输入</div>
          </div>
        ) : (
          <>
            {/* 已完成句子 */}
            {chunks.slice(-30).map(chunk => (
              <div key={chunk.id} className="flex gap-2 text-sm group hover:bg-slate-900/50 -mx-2 px-2 py-1 rounded transition-colors">
                <span className={`text-xs font-medium shrink-0 w-8 ${SPEAKER_COLORS[chunk.speaker]}`}>
                  {SPEAKER_LABELS[chunk.speaker]}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-slate-200 break-words leading-snug">
                    {chunk.text}
                  </div>
                  <div className="text-[10px] text-slate-600 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {new Date(chunk.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}

            {/* 当前累积的流式句子(还没 isFinal) */}
            {pending && (
              <div className="flex gap-2 text-sm bg-slate-900/60 -mx-2 px-2 py-1.5 rounded border border-dashed border-slate-700">
                <span className={`text-xs font-medium shrink-0 w-8 ${SPEAKER_COLORS[pendingSpeaker as keyof typeof SPEAKER_COLORS] || 'text-slate-400'}`}>
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
