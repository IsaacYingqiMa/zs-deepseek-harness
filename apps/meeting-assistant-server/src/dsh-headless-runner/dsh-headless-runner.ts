/**
 * DshHeadlessRunner —— 包装 dsh headless CLI
 *
 * 与 CodingAgent 接口一致(emit 同一组事件),这样可以无缝替换。
 *
 * 流程:
 *   1. 构造 task 描述文本(含 interpreted / target / 约束)
 *   2. spawn `node <monorepo>/apps/cli/lib/bin.js --profile headless --json`
 *   3. cwd 设为 projectPath(让 dsh 在项目目录里操作)
 *   4. 读 stdout 按行解析 JSON events
 *   5. 映射到我们的 JudgmentEvent 类型
 *   6. 失败时 fallback 到自研 CodingAgent(由调度器决定)
 *
 * dsh JSON events stream in over stdout; we treat each line as a typed
 * event after JSON.parse, so casts at the seam are deliberate.
 */
/* eslint-disable typescript/no-unnecessary-condition */
import { EventEmitter } from 'events'
import { spawn } from 'child_process'
import { logger } from '../logger.js'
import type { Task } from '../types/task.js'

/**
 * dsh bin 路径:**不自动检测**,由 ProjectsApi 显式传入(避免 Windows path 坑)
 *
 * 之前试过用 import.meta.url 反推,Windows path.dirname / path.resolve 行为不可靠
 * (dirname 返回 'D:'、back-slash 解析断等坑)。最稳的方式是显式传绝对路径。
 *
 * ProjectsApi 创建 DshHeadlessRunner 时直接传 dshBin = <monorepo>/apps/cli/lib/bin.js
 */

// sanity check:启动时打印一下(只在文件加载时跑一次)
logger.info('DshHeadlessRunner module loaded')

/** 项目类型 */
export type ProjectType = 'pure-html' | 'framework'

/** dsh 思考深度(通过 prompt 文字引导,不传给 CLI)
 *
 *  注意:dsh CLI 不支持 --thinking 参数(只支持 --json / --session-id / --profile),
 *  所以"思考深度"只能通过 prompt 里的文字引导实现。
 */
export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high'

/** 不同项目类型的默认配置 */
const DEFAULT_TIMEOUT: Record<ProjectType, number> = {
  'pure-html': 600_000,   // 10 分钟(改文件 + 简单输出)
  'framework': 600_000,   // 10 分钟(pnpm install + dev + lint 需要时间,复杂项目留余量)
}

const DEFAULT_THINKING: Record<ProjectType, ThinkingLevel> = {
  'pure-html': 'minimal',   // 最浅思考,加速响应
  'framework': 'low',       // 浅思考,保证质量
}

export interface DshHeadlessRunnerOptions {
  /** dsh 命令路径(必填:ProjectsApi 显式传) */
  dshBin: string
  /** Provider(默认 agent-default-model) */
  provider?: string
  /** Model(默认 agent-default-model.model) */
  model?: string
  /** 单任务超时(ms),默认按 projectType */
  timeoutMs?: number
  /** 项目类型(决定默认 timeout 和 thinkingLevel) */
  projectType?: ProjectType
  /** dsh 思考深度 */
  thinkingLevel?: ThinkingLevel
}

interface DshJsonEvent {
  type: string
  sessionId?: string
  text?: string
  thinking?: string
  name?: string
  tool?: string
  callId?: string
  input?: unknown
  args?: unknown
  result?: string
  status?: string
  message?: string
  error?: string
  [k: string]: unknown
}

export class DshHeadlessRunner extends EventEmitter {
  private options: Required<DshHeadlessRunnerOptions> & { projectType: ProjectType; thinkingLevel: ThinkingLevel }

  constructor(options: DshHeadlessRunnerOptions) {
    super()
    if (!options.dshBin) {
      throw new Error('DshHeadlessRunner: dshBin is required (绝对路径到 apps/cli/lib/bin.js)')
    }
    const projectType = options.projectType ?? 'framework'
    this.options = {
      dshBin: options.dshBin,
      provider: options.provider || '',
      model: options.model || '',
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT[projectType],
      projectType,
      thinkingLevel: options.thinkingLevel ?? DEFAULT_THINKING[projectType],
    }
    logger.info({
      projectType,
      timeoutMs: this.options.timeoutMs,
      thinkingLevel: this.options.thinkingLevel,
    }, 'DshHeadlessRunner configured')
  }

  /**
   * 执行 task:spawn dsh headless,读 stdout,emit 事件
   *
   * @param task - 任务
   * @param projectPath - 项目根目录(dsh 在这里操作)
   */
  async execute(task: Task, projectPath?: string): Promise<{ success: boolean; modifiedFiles: string[]; error?: string }> {
    const startTime = Date.now()
    const modifiedFiles = new Set<string>()

    // 1. 构造 task 描述(直接喂给 dsh)
    const prompt = this.buildPrompt(task)

    // 2. 确定 cwd(从参数 > task 字段 > 默认值)
    const cwd = projectPath || 'D:/InspurCode/autonomous-demo'

    logger.info({
      taskId: task.id,
      dshBin: this.options.dshBin,
      cwd,
    }, 'DshHeadlessRunner start')

    return new Promise<{ success: boolean; modifiedFiles: string[]; error?: string; duration?: number }>((resolve) => {
      // ★ dsh CLI 不支持 --thinking 参数(只有 --json / --session-id / --profile)
      // "思考深度" 通过 prompt 里的文字引导实现
      const args = [
        this.options.dshBin,
        '--profile', 'headless',
        '--json',
        prompt,
      ]
      logger.info({
        args: args.slice(0, 4),
        cwd,
        projectType: this.options.projectType,
        timeoutMs: this.options.timeoutMs,
      }, 'spawning dsh')

      const proc = spawn('node', args, {
        cwd,
        env: {
          ...process.env,
          // 无人值守 headless 必须用 'danger-full-access'
          // 'workspace-write' 会让 dsh 在需要更高级操作时尝试 escalate,但 headless 模式
          // 没有 approval channel,会抛"sandbox escalation requires approval, but no
          // approval channel is available"
          DSH_PERMISSION_MODE: 'danger-full-access',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdoutBuf = ''
      let stderrBuf = ''
      let finalText = ''
      let sawFinal = false
      let timedOut = false
      let taskSuccess = true

      // 超时
      const timer = setTimeout(() => {
        timedOut = true
        logger.warn({ taskId: task.id }, 'dsh headless timeout, killing')
        proc.kill()
      }, this.options.timeoutMs)

      proc.stdout.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString()
        // 按行解析
        const lines = stdoutBuf.split('\n')
        stdoutBuf = lines.pop() || ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const event: DshJsonEvent = JSON.parse(trimmed) as DshJsonEvent
            this.handleDshEvent(task, event, modifiedFiles)
            if (event.type === 'final') {
              sawFinal = true
              finalText = (event.text as string) || finalText
            }
            if (event.type === 'error') {
              taskSuccess = false
            }
          } catch {
            logger.warn({ line: trimmed.slice(0, 100) }, 'parse dsh event failed')
          }
        }
      })

      proc.stderr.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString()
      })

      proc.on('close', (code) => {
        clearTimeout(timer)
        const duration = Date.now() - startTime
        const modifiedFilesArr = Array.from(modifiedFiles)

        if (timedOut) {
          this.emit('task-complete', false, { error: 'timeout', modifiedFiles: modifiedFilesArr })
          resolve({ success: false, modifiedFiles: modifiedFilesArr, error: 'timeout' })
          return undefined
        }

        if (!sawFinal) {
          // dsh 没推 final → 可能出错
          logger.warn({
            code,
            duration,
            stderr: stderrBuf.slice(-500),
          }, 'dsh exited without final event')
          this.emit('task-complete', false, { error: `dsh exit ${code}`, modifiedFiles: modifiedFilesArr })
          resolve({ success: false, modifiedFiles: modifiedFilesArr, error: `dsh exit ${code}` })
          return undefined
        }

        if (code !== 0) {
          taskSuccess = false
        }

        logger.info({
          taskId: task.id,
          code,
          duration,
          modifiedFiles: modifiedFilesArr.length,
          finalTextLen: finalText.length,
        }, 'DshHeadlessRunner done')

        this.emit('task-complete', taskSuccess, {
          modifiedFiles: modifiedFilesArr,
          duration,
          finalText,
        })
        resolve({ success: taskSuccess, modifiedFiles: modifiedFilesArr, duration })
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        logger.error({ err: err.message }, 'dsh spawn failed')
        this.emit('task-complete', false, { error: err.message, modifiedFiles: [] })
        resolve({ success: false, modifiedFiles: [], error: err.message })
      })
    })
  }

  /** 把 dsh JSON event 映射到我们的内部 event */
  private handleDshEvent(task: Task, e: DshJsonEvent, modifiedFiles: Set<string>): void {
    const taskId = task.id

    switch (e.type) {
      case 'session':
        // session 已建立
        logger.info({ sessionId: e.sessionId }, 'dsh session started')
        break

      case 'thinking':
        if (e.thinking || e.text) {
          this.emit('text-delta', { taskId, delta: e.thinking || e.text })
        }
        break

      case 'text':
        if (e.text) {
          this.emit('text-delta', { taskId, delta: e.text })
        }
        break

      case 'tool_call': {
        const toolName = e.tool || e.name || 'unknown'
        const input: Record<string, unknown> = (e.input ?? e.args ?? {}) as Record<string, unknown>
        const callId = e.callId || `tool-${Date.now()}`

        // 记录文件改动(edit_file / write_file / multi_edit 等)
        if (['edit_file', 'write_file', 'multi_edit', 'str_replace', 'create_file', 'fs_write', 'str_replace_based_edit_tool'].includes(toolName)) {
          // 尝试从 input 提取文件路径(多种 schema)
          const path = extractPathFromInput(input)
          if (path) modifiedFiles.add(path)
        }

        this.emit('tool-call', { taskId, callId, name: toolName, args: input })
        break
      }

      case 'tool_result': {
        const resultStr = typeof e.result === 'string' ? e.result : JSON.stringify(e.result)
        // dsh tool_result.status 仅表示"工具调用本身完成",真正的成功/失败要看 result
        // 里是否包含 [exit code: 0] 或非零退出码
        const isError =
          e.status === 'failed' ||
          e.status === 'error' ||
          (typeof resultStr === 'string' &&
            (/\[exit code: [^0]/.test(resultStr) || /Error[:\b]/.test(resultStr)))

        this.emit('tool-result', {
          taskId,
          callId: e.callId,
          result: resultStr,
          isError,
        })
        break
      }

      case 'files-changed':
        // dsh 自己 emit 的文件改动事件(如果有)
        const filesArr = e.files
        if (Array.isArray(filesArr)) {
          for (const f of filesArr) modifiedFiles.add(f as string)
          // 版本号 bump 由 scheduler 在 'files-changed' 转发时统一处理
          this.emit('files-changed', { taskId, files: filesArr })
        }
        break

      case 'status':
        // dsh 内部状态机推进 — 仅 debug 日志,不影响任务进度
        logger.debug({
          phase: e.status,
          msg: e.message,
          turn: (e as { turn?: number }).turn,
          step: (e as { step?: number }).step,
        }, 'dsh status')
        break

      case 'error':
        // 顶层 error event(message 字段是错误描述)
        logger.error({
          error: (e as { error?: string }).error || (e as { message?: string }).message,
        }, 'dsh error')
        break

      case 'final':
        // 等 close 事件处理
        break

      default:
        logger.debug({ event: e.type }, 'unknown dsh event type')
    }
  }

  /** 构造 dsh 看到的 task 描述 */
  private buildPrompt(task: Task): string {
    if (this.options.projectType === 'pure-html') {
      return this.buildPureHtmlPrompt(task)
    }
    return this.buildFrameworkPrompt(task)
  }

  /**
   * 根据 thinkingLevel 返回 prompt 引导语
   * (dsh CLI 不支持 --thinking,这里走 prompt 引导)
   */
  private getThinkingHint(level: ThinkingLevel): string {
    switch (level) {
      case 'minimal':
        return '⚡ 这是简单任务(纯 HTML),不要过多思考,直接动手改文件,最多 4-5 个工具调用。'
      case 'low':
        return '⚡ 简洁思考,直接改文件,避免不必要的探索。'
      case 'medium':
        return ''  // 默认深度,不特别引导
      case 'high':
        return '🔍 请充分分析后再动手,确保理解清楚整体代码结构。'
      default:
        return ''
    }
  }

  /** 框架项目 prompt(原有逻辑,加思考深度引导) */
  private buildFrameworkPrompt(task: Task): string {
    const lines: string[] = []
    lines.push(`【会议任务 #${task.id.slice(0, 6)}】`)
    lines.push('')

    // ★ 思考深度提示(根据 thinkingLevel 写不同引导语)
    const thinkingHint = this.getThinkingHint(this.options.thinkingLevel)
    if (thinkingHint) {
      lines.push(thinkingHint)
      lines.push('')
    }

    lines.push('## 需求')
    lines.push(task.requirement.interpreted)
    lines.push('')

    if (task.llm?.target) {
      lines.push('## 操作对象')
      lines.push(task.llm.target)
      lines.push('')
    }

    if (task.completions.autoFilled && task.completions.autoFilled.length > 0) {
      lines.push('## AI 已自主补全')
      for (const c of task.completions.autoFilled) {
        lines.push(`- **${c.field}** = ${c.value} (${c.reason})`)
      }
      lines.push('')
    }

    lines.push('## 约束(必读)')
    lines.push('- 只改前端 prototype')
    lines.push('- 不能改: 路由 / 权限 / 第三方依赖 / 数据 schema')
    lines.push('- 改完跑 lint 或 build 验证')
    lines.push('- 失败立即停止,不要盲目重试')
    lines.push('')
    lines.push('请开始执行。')
    return lines.join('\n')
  }

  /** 纯 HTML 项目 prompt(极简,不跑 lint/build) */
  private buildPureHtmlPrompt(task: Task): string {
    const lines: string[] = []
    lines.push(`【会议任务 #${task.id.slice(0, 6)} · 纯 HTML】`)
    lines.push('')
    lines.push('⚡ 这是一个简单任务(纯 HTML 文件修改),不要过多思考或分析,直接动手。')
    lines.push('')
    lines.push('## 需求')
    lines.push(task.requirement.interpreted)
    lines.push('')

    if (task.llm?.target) {
      lines.push('## 操作对象')
      lines.push(task.llm.target)
      lines.push('')
    }

    lines.push('## 工作流程(纯 HTML 项目,极简)')
    lines.push('1. list_files → 看 HTML 文件(只看 1-2 个相关文件)')
    lines.push('2. read_file → 读取目标 HTML')
    lines.push('3. edit_file → 修改 HTML 标签/属性/内容')
    lines.push('4. 完成 → 直接结束,不需要 build/verify')
    lines.push('')

    lines.push('## 约束(必读)')
    lines.push('- 只改 .html / .css / .js 文件')
    lines.push('- **禁止**:pnpm install / lint / build / dev')
    lines.push('- **禁止**:新建依赖(package.json 不变)')
    lines.push('- **最多 4-5 个工具调用**就应完成')
    lines.push('- 失败立即停止,不要盲目重试')
    lines.push('')

    lines.push('## 输出要求')
    lines.push('改完回复: "✅ 完成 + [改动文件列表]"')
    lines.push('')
    lines.push('请开始执行。')
    return lines.join('\n')
  }
}

/** 尝试从 tool input 提取文件路径(适配多种 schema) */
function extractPathFromInput(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  const candidates = [obj.path, obj.file_path, obj.filePath, obj.target_file, obj.targetFile]
  for (const c of candidates) {
    if (typeof c === 'string' && c) return c
  }
  return null
}
