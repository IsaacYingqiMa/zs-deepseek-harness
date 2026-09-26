/**
 * AsrModuleCard —— 决策流模块卡片(替代旧 DecisionCard)
 *
 * 一次 judge() = 一个 module:
 *   - Header: 时间 / 说话人数 / 窗口大小
 *   - Body: ASR 来源(完整窗口的 chunks) + 每个 task 的 LLM 思考 + 决策结果
 *
 * 设计原则:
 *   - 只展示"成功提取到需求"的部分(unclear / rejected-by-no-target / incomplete 不展示)
 *   - rejected task 展示拒绝原因(feasibility + rejectionReason)
 *   - 可执行 task 展示当前进度 + 改动的文件
 */
import { useState } from 'react'
import {
  Check, X, ChevronDown, ChevronRight, GitBranch, MessageSquare, Target, Clock, Wrench, AlertTriangle,
} from 'lucide-react'
import { SPEAKER_COLORS, SPEAKER_LABELS } from '../types'
import type { JudgeModule, ModuleTask } from '../types'

/** 状态 → 视觉样式 */
const STATUS_STYLE: Record<string, { color: string; bg: string; border: string; icon: string; label: string }> = {
  detected:   { color: 'text-slate-300',  bg: 'bg-slate-700',         border: 'border-slate-700',        icon: '○', label: '检测到' },
  analyzing:  { color: 'text-blue-300',   bg: 'bg-blue-900/60',        border: 'border-blue-800',         icon: '🧠', label: '评估中' },
  confirmed:  { color: 'text-cyan-300',   bg: 'bg-cyan-900/60',        border: 'border-cyan-800',         icon: '🎯', label: '待执行' },
  executing:  { color: 'text-blue-200',   bg: 'bg-blue-700 animate-pulse', border: 'border-blue-500',      icon: '⏳', label: '执行中' },
  completed:  { color: 'text-green-300',  bg: 'bg-green-900/60',       border: 'border-green-700',        icon: '✓', label: '完成' },
  failed:     { color: 'text-red-300',    bg: 'bg-red-900/60',         border: 'border-red-700',          icon: '✗', label: '失败' },
  rejected:   { color: 'text-red-400',    bg: 'bg-red-900/40',         border: 'border-red-800/50',       icon: '🚫', label: '拒绝' },
  deferred:   { color: 'text-amber-300',  bg: 'bg-amber-900/40',       border: 'border-amber-800/50',     icon: '⏸', label: '暂存' },
  superseded: { color: 'text-slate-500',  bg: 'bg-slate-800',          border: 'border-slate-700',        icon: '⤵', label: '取代' },
}

const INTENT_LABELS: Record<string, string> = {
  'add-feature': '加功能',
  'modify-feature': '改功能',
  'fix-bug': '修 BUG',
  'delete-feature': '删功能',
  'data-change': '数据',
  'style-change': '样式',
}

interface AsrModuleCardProps {
  module: JudgeModule
}

export function AsrModuleCard({ module }: AsrModuleCardProps) {
  // module 默认展开(展示 task 列表)
  const [moduleOpen, setModuleOpen] = useState(true)
  // ASR 来源默认折叠(只在用户主动点开才展示)
  const [asrOpen, setAsrOpen] = useState(false)

  const speakers = Array.from(new Set(module.chunks.map(c => c.speaker)))
  const startTime = new Date(module.startedAt).toLocaleTimeString().slice(0, 5)
  const speakerLabels = speakers.map(s => SPEAKER_LABELS[s] || s).join('→')

  return (
    <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => { setModuleOpen(!moduleOpen) }}
        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-slate-800/40 text-left"
      >
        {moduleOpen
          ? <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" />
          : <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />
        }

        <Clock className="w-3 h-3 text-slate-500 shrink-0" />
        <span className="text-xs font-medium text-slate-300 font-mono">
          {startTime}
        </span>

        <span className="text-[10px] text-slate-500">
          · {speakerLabels} · {module.chunks.length} 句 · {(module.windowSpanMs / 1000).toFixed(1)}s
        </span>

        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300 border border-purple-800/50">
          提取 {module.tasks.length} 个需求
        </span>
      </button>

      {moduleOpen && (
        <div className="border-t border-slate-800 p-3 space-y-3 bg-slate-950/40 text-xs">
          {/* ASR 来源(默认折叠,点开按钮展开) */}
          <div>
            <button
              onClick={() => { setAsrOpen(!asrOpen) }}
              className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 mb-1.5"
            >
              {asrOpen
                ? <ChevronDown className="w-3 h-3" />
                : <ChevronRight className="w-3 h-3" />
              }
              <MessageSquare className="w-3 h-3" />
              <span>ASR 输入窗口</span>
              <span className="text-slate-700">·</span>
              <span className="text-slate-700">{module.chunks.length} 句话</span>
              {!asrOpen && (
                <span className="text-slate-600 italic ml-1">点击展开原始发言</span>
              )}
            </button>

            {asrOpen && (
              <div className="space-y-1 mt-1.5">
                {module.chunks.map(c => (
                  <div key={c.chunkId} className="bg-slate-900 rounded px-2 py-1.5 flex gap-2">
                    <span className={`text-[10px] font-medium shrink-0 w-8 ${SPEAKER_COLORS[c.speaker] || 'text-slate-400'}`}>
                      {SPEAKER_LABELS[c.speaker] || c.speaker}
                    </span>
                    <span className="flex-1 text-slate-200 leading-snug">{c.text}</span>
                    <span className="text-[10px] text-slate-600 shrink-0">
                      {new Date(c.timestamp).toLocaleTimeString().slice(0, 8)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 提取到的需求(默认展开) */}
          {module.tasks.length > 0 && (
            <div>
              <div className="flex items-center gap-1 text-[10px] text-slate-500 mb-1.5">
                <Target className="w-3 h-3" /> 提取到的需求
              </div>
              <div className="space-y-2">
                {module.tasks.map(task => (
                  <ModuleTaskRow key={task.taskId} task={task} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 单个 task 的展示行 */
function ModuleTaskRow({ task }: { task: ModuleTask }) {
  const style = STATUS_STYLE[task.currentStatus] ?? STATUS_STYLE.detected
  const intentLabel = INTENT_LABELS[task.intent] || task.intent

  // ★ 决策层判断:基于 LLM 可行性评估,不是 task 状态
  const f = task.feasibility
  const isLlmFeasible =
    f != null &&
    f.technical === 'feasible' &&
    f.inWhitelist &&
    f.riskLevel !== 'high' &&
    f.workload !== 'large'
  const isLlmInfeasible = f != null && !isLlmFeasible

  // 边框颜色:决策层结果(可开发=绿,非可开发=橙,未评估=灰)
  const decisionBorder =
    f == null
      ? 'border-slate-700/50'
      : isLlmFeasible
        ? 'border-green-800/60'
        : 'border-orange-800/60'

  return (
    <div className={`rounded border ${decisionBorder} bg-slate-900/40 overflow-hidden`}>
      <div className="px-2 py-1.5 flex items-start gap-2">
        {/* 决策层图标(LLM 可行性) */}
        <span className="text-sm shrink-0 w-4 text-center">
          {f == null ? (
            <span className="text-slate-500">○</span>
          ) : isLlmFeasible ? (
            <Check className="w-3.5 h-3.5 text-green-400" />
          ) : (
            <X className="w-3.5 h-3.5 text-orange-400" />
          )}
        </span>

        <div className="flex-1 min-w-0 space-y-1">
          {/* intent + target + 决策层标注 + 执行层状态 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-medium text-purple-300">
              {intentLabel}
            </span>
            {task.target && (
              <span className="flex items-center gap-0.5 text-[10px] text-amber-300">
                <Target className="w-2.5 h-2.5" />
                {task.target}
              </span>
            )}
            <span className="text-[10px] text-slate-500">
              {(task.confidence * 100).toFixed(0)}%
            </span>

            {/* 决策层 LLM 可行性 */}
            {f != null && (
              <span className={`text-[10px] px-1 py-0.5 rounded border ${
                isLlmFeasible
                  ? 'bg-green-900/30 text-green-700'
                  : 'bg-orange-900/30 text-orange-700'
              }`}>
                {isLlmFeasible ? '✓ 可开发' : '✗ 非可开发'}
              </span>
            )}

            {/* 执行层 task 状态 */}
            <span className={`ml-auto text-[10px] px-1 py-0.5 rounded ${style.bg} ${style.color}`}>
              {style.label}
            </span>
          </div>

          {/* LLM 提取 reasoning */}
          <div className="text-slate-300 italic text-[11px] flex items-start gap-1">
            <span className="text-slate-500 not-italic shrink-0">LLM:</span>
            <span>{task.reasoning}</span>
          </div>

          {/* LLM 可行性评估 reasoning(非可开发时重点展示) */}
          {isLlmInfeasible && f.reasoning && (
            <div className="text-orange-300/80 italic text-[11px] flex items-start gap-1">
              <span className="text-orange-500 not-italic shrink-0">可行性:</span>
              <span>{f.reasoning}</span>
            </div>
          )}

          {/* Task ID + 来源 */}
          <div className="flex items-center gap-2 text-[10px] text-slate-600 font-mono">
            <GitBranch className="w-2.5 h-2.5" />
            <span>#{task.taskId.slice(0, 6)}</span>
            {task.sourceChunkId && (
              <span>· 来源 #{task.sourceChunkId.slice(0, 6)}</span>
            )}
          </div>

          {/* 完成时改的文件(执行层信息) */}
          {task.currentStatus === 'completed' && task.modifiedFiles && task.modifiedFiles.length > 0 && (
            <div className="text-[10px] bg-green-950/20 border border-green-900/40 rounded p-1.5 mt-1">
              <div className="text-green-400 flex items-center gap-1">
                <Wrench className="w-2.5 h-2.5" />
                改动 {task.modifiedFiles.length} 个文件
              </div>
              <div className="font-mono text-slate-400 mt-0.5 space-y-0.5">
                {task.modifiedFiles.slice(0, 3).map(f => (
                  <div key={f} className="truncate">· {f}</div>
                ))}
                {task.modifiedFiles.length > 3 && (
                  <div className="text-slate-500">... +{task.modifiedFiles.length - 3}</div>
                )}
              </div>
            </div>
          )}

          {/* 执行中提示 */}
          {task.currentStatus === 'executing' && (
            <div className="text-[10px] text-blue-300 flex items-center gap-1">
              <Check className="w-2.5 h-2.5 animate-pulse" />
              AI 正在改代码... (展开 TaskList 查看实时步骤)
            </div>
          )}

          {/* dsh 执行失败(但 LLM 判断可行 → 决策层仍标"可开发") */}
          {task.currentStatus === 'failed' && isLlmFeasible && (
            <div className="text-[10px] bg-yellow-950/30 border border-yellow-900/40 rounded p-1.5 mt-1">
              <div className="text-yellow-400 flex items-center gap-1">
                <AlertTriangle className="w-2.5 h-2.5" />
                决策层判可行,但 dsh 执行失败: {task.rejectionReason}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
