/**
 * 预览面板(iframe + 自动刷新)
 *
 * 监听 CodingAgent 的 files-changed 事件,自动 reload iframe
 */
import { useEffect, useRef } from 'react'
import { ExternalLink, RefreshCw, Eye, EyeOff } from 'lucide-react'
import { useMeetingStore } from '../store'

export function PreviewPanel() {
  const currentProject = useMeetingStore(s => s.currentProject)
  const lastFilesChanged = useMeetingStore(s => s.lastFilesChanged)
  const setIframeRef = useMeetingStore(s => s.setIframeRef)
  const localIframeRef = useRef<HTMLIFrameElement>(null)

  // 注册 iframe ref 到 store(让 hooks 能调用 reload)
  useEffect(() => {
    setIframeRef(localIframeRef.current)
    return () => setIframeRef(null)
  }, [currentProject])

  // 折叠状态(默认展开)
  const collapsed = false

  // 监听文件改动 → reload iframe(防抖 800ms,防止多个文件同时改时多次 reload)
  useEffect(() => {
    if (!lastFilesChanged) return

    const timer = setTimeout(() => {
      const iframe = localIframeRef.current
      if (iframe && iframe.contentWindow) {
        try {
          iframe.contentWindow.location.reload()
        } catch {
          // 跨域等错误,fallback:替换 src
          if (currentProject) {
            const url = new URL(iframe.src)
            url.searchParams.set('_t', String(Date.now()))
            iframe.src = url.toString()
          }
        }
      }
    }, 800)

    return () => clearTimeout(timer)
  }, [lastFilesChanged, currentProject])

  if (collapsed) return null

  return (
    <div className="h-full flex flex-col bg-slate-950 border-l border-slate-800">
      <div className="bg-slate-900 border-b border-slate-800 px-3 py-2 flex items-center gap-2">
        <Eye className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-medium text-slate-200">实时预览</span>
        {lastFilesChanged && (
          <span className="text-xs px-2 py-0.5 rounded bg-green-900/50 text-green-400 border border-green-800 animate-pulse">
            🔄 自动刷新中
          </span>
        )}
        {currentProject && (
          <a
            href={currentProject.previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-xs text-slate-500 hover:text-blue-400 flex items-center gap-1"
          >
            <ExternalLink className="w-3 h-3" />
            新窗口
          </a>
        )}
      </div>
      <div className="flex-1 bg-slate-950 relative">
        {currentProject ? (
          <>
            <iframe
              key={currentProject.previewUrl}
              ref={localIframeRef}
              src={currentProject.previewUrl}
              className="w-full h-full bg-white"
              title="Project Preview"
              sandbox="allow-scripts allow-same-origin allow-forms"
            />
            {lastFilesChanged && (
              <div className="absolute top-2 right-2 bg-blue-600 text-white text-xs px-2 py-1 rounded shadow-lg animate-pulse">
                <RefreshCw className="w-3 h-3 inline mr-1" />
                {lastFilesChanged.files[0]?.split('/').pop()} 已改
              </div>
            )}
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-slate-600 text-sm">
            <div className="text-center">
              <EyeOff className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <div>请先选择项目</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
