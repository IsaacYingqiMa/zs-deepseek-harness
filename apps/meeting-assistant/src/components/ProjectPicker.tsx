/**
 * 项目选择组件
 */
import { useEffect, useState } from 'react'
import { FolderOpen, RefreshCw, Loader2 } from 'lucide-react'
import { useMeetingStore } from '../store'
import type { ProjectInfo } from '../types'

export function ProjectPicker() {
  const projects = useMeetingStore(s => s.projects)
  const setProjects = useMeetingStore(s => s.setProjects)
  const currentProject = useMeetingStore(s => s.currentProject)
  const setCurrentProject = useMeetingStore(s => s.setCurrentProject)
  const setCodeMap = useMeetingStore(s => s.setCodeMap)

  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string>('')

  useEffect(() => {
    loadProjects()
  }, [])

  async function loadProjects() {
    setLoading(true)
    try {
      const res = await fetch('/api/projects')
      const text = await res.text()
      console.log('[loadProjects] status:', res.status, 'body:', text.substring(0, 200))

      if (!res.ok) {
        alert(`加载项目失败 (${res.status}):\n${text.substring(0, 300)}`)
        return
      }

      const data = JSON.parse(text)
      setProjects(data.projects || [])
    } catch (err) {
      console.error('Failed to load projects', err)
      alert(`加载项目失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  async function selectProject(p: ProjectInfo) {
    setLoading(true)
    try {
      const res = await fetch('/api/projects/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: p.path, framework: p.framework }),
      })
      const data = await res.json()
      if (data.ok) {
        setCurrentProject(data.project)
        setCodeMap(data.codeMap)
      } else {
        alert(`启动失败: ${data.error}`)
      }
    } catch (err) {
      console.error('Failed to select project', err)
      alert(`启动失败: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-slate-900 border-b border-slate-800 p-3 flex items-center gap-3">
      <FolderOpen className="w-5 h-5 text-blue-400" />
      <span className="text-sm text-slate-400">项目:</span>

      {!currentProject ? (
        <>
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            disabled={loading}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm flex-1 max-w-md"
          >
            <option value="">-- 选择项目 --</option>
            {projects.map(p => (
              <option key={p.path} value={p.path}>
                {p.name} ({p.framework}) {p.hasShadcn ? '✨' : ''}
              </option>
            ))}
          </select>

          <button
            onClick={() => {
              const p = projects.find(x => x.path === selected)
              if (p) selectProject(p)
            }}
            disabled={!selected || loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 px-3 py-1.5 rounded text-sm flex items-center gap-1.5"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            启动预览
          </button>

          <button
            onClick={loadProjects}
            disabled={loading}
            className="p-1.5 hover:bg-slate-800 rounded"
            title="刷新"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </>
      ) : (
        <>
          <span className="text-sm">
            {currentProject.path.split(/[\\/]/).pop()}
            <span className="text-slate-500 ml-2">({currentProject.framework})</span>
          </span>
          <span className="text-xs text-green-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full"></span>
            运行中 :{currentProject.port}
          </span>
          <button
            onClick={async () => {
              await fetch('/api/projects/stop', { method: 'POST' })
              setCurrentProject(null)
            }}
            className="text-xs text-slate-500 hover:text-red-400 ml-auto"
          >
            停止
          </button>
        </>
      )}
    </div>
  )
}
