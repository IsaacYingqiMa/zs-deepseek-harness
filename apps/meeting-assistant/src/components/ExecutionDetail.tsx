/**
 * CodingAgent 执行详情
 *
 * 显示 AI 的完整工作过程:
 *  - 思考文本(thinking)
 *  - 工具调用(tool-call):read_file / edit_file / write_file / bash / list_files
 *  - 工具结果(tool-result)
 */
import { useState } from 'react'
import { ChevronDown, ChevronRight, Brain, Wrench, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import type { CodingStep } from '../store'

const TOOL_ICONS: Record<string, string> = {
  // CodingAgent(自研)
  read_file: '📖',
  edit_file: '✏️',
  write_file: '📝',
  bash: '🖥️',
  list_files: '📂',
  // dsh headless(实际用到的工具)
  pwsh: '🖥️',
  str_replace_based_edit_tool: '✏️',
  str_replace: '✏️',
  multi_edit: '✏️',
  create_file: '📝',
  fs_write: '📝',
}

/** 工具分类(颜色) */
const TOOL_KIND: Record<string, 'read' | 'edit' | 'write' | 'shell'> = {
  read_file: 'read',
  list_files: 'read',
  edit_file: 'edit',
  str_replace_based_edit_tool: 'edit',
  str_replace: 'edit',
  multi_edit: 'edit',
  write_file: 'write',
  create_file: 'write',
  fs_write: 'write',
  bash: 'shell',
  pwsh: 'shell',
}

export function ExecutionDetail({ steps }: { steps: CodingStep[] }) {
  const [expanded, setExpanded] = useState(true)

  if (steps.length === 0) {
    return (
      <div className="text-xs text-slate-600 italic mt-1">暂无执行过程</div>
    )
  }

  // 按 callId 分组,tool-call 和 tool-result 配对展示
  const calls = new Map<string, { call?: CodingStep; result?: CodingStep }>()
  const thinks: CodingStep[] = []

  for (const s of steps) {
    if (s.type === 'thinking') {
      thinks.push(s)
    } else {
      const id = s.callId || `${s.type}-${Math.random()}`
      const entry = calls.get(id) || {}
      if (s.type === 'tool-call') entry.call = s
      else entry.result = s
      calls.set(id, entry)
    }
  }

  return (
    <div className="mt-2 border-t border-slate-800 pt-2">
      <button
        onClick={() => { setExpanded(!expanded) }}
        className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Brain className="w-3 h-3" />
        <span>AI 执行过程 ({steps.length} 步)</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 max-h-96 overflow-y-auto">
          {/* AI 思考 */}
          {thinks.map((t, i) => (
            <div key={`think-${i}`} className="text-xs bg-slate-950/50 rounded p-2 border border-slate-800">
              <div className="flex items-start gap-1.5 mb-1">
                <Brain className="w-3 h-3 text-blue-400 mt-0.5 shrink-0" />
                <span className="text-blue-400 font-medium">思考</span>
                <span className="text-slate-600 ml-auto">
                  {new Date(t.at).toLocaleTimeString()}
                </span>
              </div>
              <div className="text-slate-300 whitespace-pre-wrap break-words leading-relaxed">
                {t.text}
              </div>
            </div>
          ))}

          {/* 工具调用 + 结果 */}
          {Array.from(calls.entries()).map(([callId, { call, result }]) => {
            if (!call) return null
            const toolIcon = TOOL_ICONS[call.toolName || ''] || '🔧'
            const toolName = call.toolName || 'unknown'
            const toolKind = TOOL_KIND[toolName] ?? 'edit'
            const toolColor = {
              read: 'text-cyan-400',
              edit: 'text-amber-400',
              write: 'text-green-400',
              shell: 'text-purple-400',
            }[toolKind]
            const argsStr = call.toolArgs
              ? JSON.stringify(call.toolArgs, null, 2)
              : ''
            const resultStr = result?.result || '(等待结果...)'

            return (
              <div key={callId} className="text-xs">
                {/* 调用 */}
                <div className="bg-slate-950/50 rounded p-2 border border-slate-800">
                  <div className="flex items-start gap-1.5 mb-1">
                    <Wrench className={`w-3 h-3 ${toolColor} mt-0.5 shrink-0`} />
                    <span className={`${toolColor} font-medium`}>
                      {toolIcon} {toolName}
                    </span>
                    <span className="text-slate-600 ml-auto">
                      {new Date(call.at).toLocaleTimeString()}
                    </span>
                  </div>
                  {argsStr && (
                    <pre className="text-slate-400 bg-slate-900 rounded p-1.5 mt-1 overflow-x-auto text-[10px] leading-snug">
                      {argsStr.slice(0, 500)}
                      {argsStr.length > 500 && '\n...'}
                    </pre>
                  )}
                </div>

                {/* 结果 */}
                {result && (
                  <div className={`mt-1 ml-4 rounded p-2 border ${
                    result.isError
                      ? 'bg-red-950/30 border-red-900'
                      : 'bg-green-950/20 border-green-900/50'
                  }`}>
                    <div className="flex items-start gap-1.5 mb-1">
                      {result.isError
                        ? <AlertCircle className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />
                        : <CheckCircle2 className="w-3 h-3 text-green-400 mt-0.5 shrink-0" />}
                      <span className={result.isError ? 'text-red-400 font-medium' : 'text-green-400 font-medium'}>
                        {result.isError ? '错误' : '结果'}
                      </span>
                    </div>
                    <pre className="text-slate-300 whitespace-pre-wrap break-words leading-relaxed text-[10px]">
                      {(resultStr || '').slice(0, 500)}
                      {(resultStr || '').length > 500 && '\n...'}
                    </pre>
                  </div>
                )}

                {/* 等待结果 */}
                {!result && (
                  <div className="mt-1 ml-4 flex items-center gap-1.5 text-slate-500">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>等待结果...</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
