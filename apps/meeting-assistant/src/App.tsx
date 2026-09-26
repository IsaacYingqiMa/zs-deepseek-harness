import { useEventStream } from './hooks'
import { ProjectPicker } from './components/ProjectPicker'
import { RecorderPanel } from './components/RecorderPanel'
import { TranscriptStream } from './components/TranscriptStream'
import { TaskList } from './components/TaskList'
import { AiReasoningStream } from './components/AiReasoningStream'
import { AgentStatusRow } from './components/AgentStatusRow'
import { useMeetingStore } from './store'
import { ExternalLink } from 'lucide-react'

export function App() {
  useEventStream()
  const currentProject = useMeetingStore(s => s.currentProject)

  // 整页背景渐变
  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      {/* 顶部:标题栏 + 项目选择 + 预览跳转按钮 */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm shadow-lg">
        <div className="flex items-center gap-4 px-4 py-2.5">
          {/* ★ 产品 Logo:隆中定策(书法风格)+ 副标 */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-700 via-amber-600 to-amber-800 flex items-center justify-center shadow-lg border border-amber-500/30">
              <span
                className="text-lg font-bold text-amber-50 leading-none"
                style={{ fontFamily: 'STKaiti, KaiTi, KaiTi_GB2312, 楷体, serif' }}
              >
                龙
              </span>
            </div>
            <div>
              <h1
                className="text-lg font-bold tracking-wider leading-none"
                style={{
                  fontFamily: 'STKaiti, KaiTi, KaiTi_GB2312, 楷体, Songti SC, serif',
                  color: '#e8d9b5',
                  textShadow: '0 1px 0 rgba(255,255,255,0.1)',
                }}
              >
                隆中定策
              </h1>
              <div className="text-[10px] text-slate-400 leading-tight mt-0.5 tracking-wide">
                草庐一声雷 · 千里定乾坤
              </div>
            </div>
          </div>

          <div className="flex-1 max-w-2xl">
            <ProjectPicker />
          </div>

          {/* ★ 预览跳转新窗口按钮 */}
          {currentProject && (
            <a
              href={currentProject.previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs shadow-lg transition-colors"
              title="在新窗口打开预览"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              预览新窗口
              <span className="text-[10px] text-blue-100/70 font-mono ml-1">:{currentProject.port}</span>
            </a>
          )}
        </div>
        <RecorderPanel />
        {/* ★ 智能体工作状态(意图提取 / 可行性 / 规则 / 执行) */}
        <div className="bg-slate-900/40 border-t border-slate-800 px-4 py-2 flex items-center gap-3">
          <span className="text-xs text-slate-500 font-medium shrink-0">智能体</span>
          <AgentStatusRow />
        </div>
      </header>

      {/* 主区域:三栏 1/3 + 1/3 + 1/3 */}
      {/*   左:实时转写 | 中:AI 决策流 | 右:任务清单 */}
      {/*   PreviewPanel 暂时隐藏,改用顶部"预览新窗口"按钮 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧 1/3:实时转写(始终展开,header 在 TranscriptStream 内部) */}
        <div className="w-1/3 min-w-[300px] border-r border-slate-800 flex flex-col bg-slate-950/60">
          <div className="flex-1 min-h-0">
            <TranscriptStream />
          </div>
        </div>

        {/* 中间 1/3:AI 决策流 */}
        <div className="flex-1 border-r border-slate-800 flex flex-col bg-slate-950/40 min-w-0">
          <AiReasoningStream />
        </div>

        {/* 右侧 1/3:任务清单 */}
        <div className="w-1/3 min-w-[360px] flex flex-col bg-slate-950/40 min-w-0">
          <TaskList />
        </div>
      </div>
    </div>
  )
}
