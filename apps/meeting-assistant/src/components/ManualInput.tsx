/**
 * 手动输入面板 - 隔离于录音
 *
 * 用法:
 *   1. 选说话人(老板/PM/开发)
 *   2. 输入文本
 *   3. 发送 → 文本走 /ws/manual-input → 后端判断引擎
 *
 * 可以跟录音同时使用(两个独立通道)。
 */
import { useState } from 'react'
import { Send, User, Wifi, WifiOff } from 'lucide-react'
import { useManualInput, type ManualSpeaker } from '../hooks'

export function ManualInput() {
  const { connected, send } = useManualInput()
  const [text, setText] = useState('')
  const [speaker, setSpeaker] = useState<ManualSpeaker>('unknown')
  const [history, setHistory] = useState<Array<{ id: number; text: string; speaker: ManualSpeaker; at: number }>>([])

  const handleSend = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    if (!connected) {
      alert('WebSocket 未连接,请检查后端')
      return
    }

    const ok = send(trimmed, speaker)
    if (ok) {
      setHistory(h => [{ id: Date.now(), text: trimmed, speaker, at: Date.now() }, ...h].slice(0, 20))
      setText('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="bg-slate-900 border-b border-slate-800 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <User className="w-4 h-4 text-slate-400" />
        <span className="text-xs text-slate-400 font-medium">手动输入(隔离于录音)</span>
        <span className="ml-auto flex items-center gap-1 text-xs">
          {connected ? (
            <>
              <Wifi className="w-3 h-3 text-green-400" />
              <span className="text-green-400">已连接</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3 h-3 text-red-400" />
              <span className="text-red-400">未连接</span>
            </>
          )}
        </span>
      </div>

      <div className="flex gap-2 items-start">
        <select
          value={speaker}
          onChange={(e) => { setSpeaker(e.target.value as ManualSpeaker) }}
          className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm shrink-0"
        >
          <option value="unknown">? 未知</option>
          <option value="boss">👑 老板</option>
          <option value="pm">💼 产品</option>
          <option value="dev">💻 开发</option>
        </select>

        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value) }}
          onKeyDown={handleKeyDown}
          placeholder="输入会议中的一句话(例:'客户列表筛选太弱了,加个多条件筛选')Ctrl+Enter 发送"
          rows={2}
          className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm resize-none focus:outline-none focus:border-blue-500"
        />

        <button
          onClick={handleSend}
          disabled={!text.trim() || !connected}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 px-3 py-1 rounded text-sm flex items-center gap-1 shrink-0"
          style={{ height: 'auto', minHeight: '52px' }}
        >
          <Send className="w-4 h-4" />
          发送
        </button>
      </div>

      {history.length > 0 && (
        <details className="text-xs">
          <summary className="text-slate-500 cursor-pointer hover:text-slate-300">
            历史输入 ({history.length})
          </summary>
          <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
            {history.map(h => (
              <div key={h.id} className="text-slate-400 font-mono">
                <span className="text-slate-600">[{new Date(h.at).toLocaleTimeString()}]</span>
                <span className={`ml-1 ${h.speaker === 'boss' ? 'text-boss' : h.speaker === 'pm' ? 'text-pm' : h.speaker === 'dev' ? 'text-dev' : 'text-slate-500'}`}>
                  {h.speaker}
                </span>
                <span className="ml-1">{h.text}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
