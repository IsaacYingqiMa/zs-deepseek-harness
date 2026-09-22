import { useEventStream } from './hooks'
import { ProjectPicker } from './components/ProjectPicker'
import { RecorderPanel } from './components/RecorderPanel'
import { ManualInput } from './components/ManualInput'
import { TranscriptStream } from './components/TranscriptStream'
import { TaskList } from './components/TaskList'
import { AiReasoningStream } from './components/AiReasoningStream'
import { PreviewPanel } from './components/PreviewPanel'
import { Sparkles } from 'lucide-react'

export function App() {
  useEventStream()

  // 整页背景渐变
  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      {/* 顶部:标题栏 + 项目选择 */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm shadow-lg">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-slate-100 leading-tight">AI 会议助手</h1>
              <div className="text-[10px] text-slate-500 leading-tight">自主判断 · 自主改代码</div>
            </div>
          </div>
          <div className="flex-1 max-w-2xl">
            <ProjectPicker />
          </div>
        </div>
        <RecorderPanel />
        <ManualInput />
      </header>

      {/* 主区域:三栏布局 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧:实时转写 */}
        <div className="w-80 border-r border-slate-800 flex flex-col bg-slate-950/60">
          <TranscriptStream />
        </div>

        {/* 中间:任务清单 + AI 思考流 */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-hidden">
            <TaskList />
          </div>
          <div className="h-56 border-t border-slate-800">
            <AiReasoningStream />
          </div>
        </div>

        {/* 右侧:实时预览 */}
        <div className="w-2/5 min-w-[420px]">
          <PreviewPanel />
        </div>
      </div>
    </div>
  )
}
