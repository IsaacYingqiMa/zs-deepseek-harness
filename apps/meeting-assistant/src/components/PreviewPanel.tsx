/**
 * PreviewPanel —— 实时预览面板(iframe + 工具栏)
 *
 * 功能:
 *   - 工具栏:端口显示 / 桌面·平板·手机尺寸切换 / 手动刷新 / 全屏 / 新窗口打开
 *   - 监听 CodingAgent 的 files-changed 事件,自动 reload iframe(800ms 防抖)
 *   - 全屏模式:fixed inset-0 iframe 占满视口(React Portal,避开 backdrop-filter)
 *   - ESC 退出全屏
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ExternalLink, RefreshCw, Eye, EyeOff,
  Maximize2, Minimize2, Monitor, Tablet, Smartphone,
} from 'lucide-react'
import { useMeetingStore } from '../store'

type DeviceMode = 'desktop' | 'tablet' | 'phone'

const DEVICE_SIZES: Record<DeviceMode, { width: number; height: number; label: string; Icon: typeof Monitor }> = {
  desktop: { width: 0,    height: 0,    label: '桌面', Icon: Monitor   },  // 0 = 自适应
  tablet:  { width: 768,  height: 1024, label: '平板', Icon: Tablet    },
  phone:   { width: 375,  height: 667,  label: '手机', Icon: Smartphone },
}

export function PreviewPanel() {
  const currentProject = useMeetingStore(s => s.currentProject)
  const lastFilesChanged = useMeetingStore(s => s.lastFilesChanged)
  const setIframeRef = useMeetingStore(s => s.setIframeRef)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const fullscreenIframeRef = useRef<HTMLIFrameElement>(null)

  // 设备尺寸模式
  const [device, setDevice] = useState<DeviceMode>('desktop')
  // 全屏模式
  const [fullscreen, setFullscreen] = useState(false)
  // 手动刷新计数器(每次点击 +1,触发 useEffect 重新加载 iframe)
  const [reloadTick, setReloadTick] = useState(0)

  // 注册 iframe ref 到 store(让 hooks 调用 reload)
  useEffect(() => {
    setIframeRef(iframeRef.current)
    return () => { setIframeRef(null) }
  }, [currentProject])

  // 自动 reload(防抖 800ms)
  useEffect(() => {
    if (!lastFilesChanged) return
    const timer = setTimeout(() => {
      const iframe = iframeRef.current
      if (iframe && iframe.contentWindow) {
        try {
          iframe.contentWindow.location.reload()
        } catch {
          if (currentProject) {
            const url = new URL(iframe.src)
            url.searchParams.set('_t', String(Date.now()))
            iframe.src = url.toString()
          }
        }
      }
    }, 800)
    return () => { clearTimeout(timer) }
  }, [lastFilesChanged, currentProject])

  // 手动刷新触发(点击刷新按钮)
  useEffect(() => {
    if (reloadTick === 0) return
    const iframe = iframeRef.current
    if (!iframe) return
    try {
      iframe.contentWindow?.location.reload()
    } catch {
      if (currentProject) {
        const url = new URL(iframe.src)
        url.searchParams.set('_t', String(Date.now()))
        iframe.src = url.toString()
      }
    }
  }, [reloadTick, currentProject])

  // 全屏模式:监听 ESC 退出
  useEffect(() => {
    if (!fullscreen) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', handleEsc)
    return () => { window.removeEventListener('keydown', handleEsc) }
  }, [fullscreen])

  // iframe wrapper 尺寸(根据设备模式)
  const deviceSize = DEVICE_SIZES[device]

  // 渲染 iframe 内容(普通模式 + 全屏模式共用)
  const renderIframe = (ref: React.RefObject<HTMLIFrameElement>, fullscreenMode = false) => {
    if (!currentProject) return null
    if (fullscreenMode) {
      return (
        <iframe
          ref={ref}
          src={currentProject.previewUrl}
          className="w-full h-full bg-white"
          title="Project Preview (Fullscreen)"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      )
    }
    // 桌面模式:占满容器
    if (device === 'desktop') {
      return (
        <iframe
          ref={ref}
          key={currentProject.previewUrl + device}
          src={currentProject.previewUrl}
          className="w-full h-full bg-white"
          title="Project Preview"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      )
    }
    // 平板/手机模式:固定尺寸 + 居中 + 深色背景
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-900 overflow-auto p-4">
        <div
          className="bg-slate-800 rounded-lg shadow-2xl overflow-hidden border border-slate-700"
          style={{ width: deviceSize.width, height: deviceSize.height, maxWidth: '100%', maxHeight: '100%' }}
        >
          <iframe
            ref={ref}
            key={currentProject.previewUrl + device}
            src={currentProject.previewUrl}
            className="w-full h-full bg-white"
            title={`Project Preview (${deviceSize.label})`}
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        </div>
      </div>
    )
  }

  // 工具栏
  const toolbar = (
    <div className="bg-slate-900 border-b border-slate-800 px-3 py-1.5 flex items-center gap-2 shrink-0">
      <Eye className="w-4 h-4 text-blue-400" />
      <span className="text-sm font-medium text-slate-200">实时预览</span>

      {currentProject && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
          {currentProject.port}
        </span>
      )}

      {lastFilesChanged && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/50 text-green-400 border border-green-800 animate-pulse">
          ● 自动刷新中
        </span>
      )}

      {/* 设备尺寸切换 */}
      <div className="flex items-center gap-0.5 ml-auto bg-slate-800/60 rounded p-0.5">
        {(Object.keys(DEVICE_SIZES) as DeviceMode[]).map((d) => {
          const cfg = DEVICE_SIZES[d]
          const Icon = cfg.Icon
          const active = device === d
          return (
            <button
              key={d}
              onClick={() => { setDevice(d) }}
              title={cfg.label}
              className={`p-1 rounded transition-colors ${
                active ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-700 hover:text-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          )
        })}
      </div>

      {/* 手动刷新 */}
      <button
        onClick={() => { setReloadTick(t => t + 1) }}
        title="刷新"
        className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-blue-400"
      >
        <RefreshCw className="w-3.5 h-3.5" />
      </button>

      {/* 全屏 */}
      <button
        onClick={() => { setFullscreen(true) }}
        title="全屏"
        className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-blue-400"
      >
        <Maximize2 className="w-3.5 h-3.5" />
      </button>

      {/* 新窗口打开 */}
      {currentProject && (
        <a
          href={currentProject.previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="新窗口打开"
          className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-blue-400"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  )

  if (!currentProject) {
    return (
      <div className="h-full flex flex-col bg-slate-950 border-l border-slate-800 min-w-0">
        {toolbar}
        <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">
          <div className="text-center">
            <EyeOff className="w-12 h-12 mx-auto mb-2 opacity-30" />
            <div>请先选择项目</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-slate-950 border-l border-slate-800 min-w-0">
      {toolbar}
      <div className="flex-1 relative min-h-0">
        {renderIframe(iframeRef)}

        {/* 文件改动提示浮层 */}
        {lastFilesChanged && (
          <div className="absolute top-2 right-2 bg-blue-600 text-white text-xs px-2 py-1 rounded shadow-lg animate-pulse z-10">
            <RefreshCw className="w-3 h-3 inline mr-1" />
            {lastFilesChanged.files[0]?.split('/').pop()} 已改
          </div>
        )}
      </div>

      {/* 全屏模式:用 Portal 渲染到 body,避开 backdrop-filter */}
      {fullscreen && createPortal(
        <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">
          {/* 全屏工具栏 */}
          <div className="bg-slate-900 border-b border-slate-800 px-3 py-2 flex items-center gap-2 shrink-0">
            <Eye className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-medium text-slate-200">实时预览 · 全屏</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono ml-1">
              {currentProject.port}
            </span>

            {/* 设备尺寸切换 */}
            <div className="flex items-center gap-0.5 ml-3 bg-slate-800/60 rounded p-0.5">
              {(Object.keys(DEVICE_SIZES) as DeviceMode[]).map((d) => {
                const cfg = DEVICE_SIZES[d]
                const Icon = cfg.Icon
                const active = device === d
                return (
                  <button
                    key={d}
                    onClick={() => { setDevice(d) }}
                    title={cfg.label}
                    className={`p-1 rounded transition-colors ${
                      active ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-700 hover:text-slate-100'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </button>
                )
              })}
            </div>

            <button
              onClick={() => { setReloadTick(t => t + 1) }}
              title="刷新"
              className="ml-auto p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-blue-400"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => { setFullscreen(false) }}
              title="退出全屏 (ESC)"
              className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-blue-400"
            >
              <Minimize2 className="w-3.5 h-3.5" />
            </button>

            <span className="text-[10px] text-slate-500 ml-1">ESC 退出</span>
          </div>

          {/* 全屏 iframe */}
          <div className="flex-1 relative min-h-0">
            {renderIframe(fullscreenIframeRef, true)}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
