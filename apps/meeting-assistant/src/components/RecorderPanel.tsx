/**
 * 录音控制面板
 */
import { Mic, MicOff, Trash2, Circle } from 'lucide-react'
import { useRecorder } from '../hooks'
import { useMeetingStore } from '../store'

export function RecorderPanel() {
  const { isRecording, start, stop, error } = useRecorder()
  const wsConnected = useMeetingStore(s => s.wsConnected)
  const reset = useMeetingStore(s => s.reset)

  return (
    <div className="bg-slate-900/60 border-t border-slate-800 px-4 py-2 flex items-center gap-3 text-xs">
      {error && (
        <span className="text-red-400 bg-red-900/30 px-2 py-0.5 rounded border border-red-900">
          ⚠️ {error}
        </span>
      )}

      <span className="flex items-center gap-1.5 text-slate-400">
        {wsConnected ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 shadow shadow-green-500/50"></span>
            <span className="text-green-400">后端已连接</span>
          </>
        ) : (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
            <span className="text-red-400">后端未连接</span>
          </>
        )}
      </span>

      <button
        onClick={isRecording ? stop : start}
        className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all ${
          isRecording
            ? 'bg-red-600 hover:bg-red-700 text-white shadow-md shadow-red-500/30'
            : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/30'
        }`}
      >
        {isRecording ? (
          <>
            <MicOff className="w-3.5 h-3.5" />
            停止录音
          </>
        ) : (
          <>
            <Mic className="w-3.5 h-3.5" />
            开始录音
          </>
        )}
      </button>

      {isRecording && (
        <span className="flex items-center gap-1.5 text-red-400">
          <Circle className="w-2 h-2 fill-red-500 animate-pulse" />
          录音中
        </span>
      )}

      <button
        onClick={reset}
        className="ml-auto px-2 py-1 hover:bg-slate-800 rounded text-slate-400 hover:text-red-400 flex items-center gap-1"
        title="清空"
      >
        <Trash2 className="w-3.5 h-3.5" />
        清空
      </button>
    </div>
  )
}
