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
 */
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

export interface DshHeadlessRunnerOptions {
  /** dsh 命令路径(必填:ProjectsApi 显式传) */
  dshBin: string
  /** Provider(默认 agent-default-model) */
  provider?: string
  /** Model(默认 agent-default-model.model) */
  model?: string
  /** 单任务超时(ms),默认 5 分钟 */
  timeoutMs?: number
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
  private options: Required<DshHeadlessRunnerOptions>

  constructor(options: DshHeadlessRunnerOptions) {
    super()
    if (!options.dshBin) {
      throw new Error('DshHeadlessRunner: dshBin is required (绝对路径到 apps/cli/lib/bin.js)')
    }
    this.options = {
      dshBin: options.dshBin,
      provider: options.provider || '',
      model: options.model || '',
      timeoutMs: options.timeoutMs ?? 300_000,
    }
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
      const args = [this.options.dshBin, '--profile', 'headless', '--json', prompt]
      logger.info({
        args: args.slice(0, 4),
        cwd,
      }, 'spawning dsh')

      const proc = spawn('node', args, {
        cwd,
        env: {
          ...process.env,
          DSH_PERMISSION_MODE: 'workspace-write',
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
            const event: DshJsonEvent = JSON.parse(trimmed)
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
          return resolve({ success: false, modifiedFiles: modifiedFilesArr, error: 'timeout' })
        }

        if (!sawFinal) {
          // dsh 没推 final → 可能出错
          logger.warn({
            code,
            duration,
            stderr: stderrBuf.slice(-500),
          }, 'dsh exited without final event')
          this.emit('task-complete', false, { error: `dsh exit ${code}`, modifiedFiles: modifiedFilesArr })
          return resolve({ success: false, modifiedFiles: modifiedFilesArr, error: `dsh exit ${code}` })
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
        const toolName = (e.tool || e.name || 'unknown') as string
        const input: Record<string, unknown> = (e.input ?? e.args ?? {}) as Record<string, unknown>
        const callId = (e.callId || `tool-${Date.now()}`) as string

        // 记录文件改动(edit_file / write_file / multi_edit 等)
        if (['edit_file', 'write_file', 'multi_edit', 'str_replace', 'create_file', 'fs_write', 'str_replace_based_edit_tool'].includes(toolName)) {
          // 尝试从 input 提取文件路径(多种 schema)
          const path = extractPathFromInput(input)
          if (path) modifiedFiles.add(path)
        }

        this.emit('tool-call', { taskId, callId, name: toolName, args: input })
        break
      }

      case 'tool_result':
        this.emit('tool-result', {
          taskId,
          callId: e.callId,
          result: typeof e.result === 'string' ? e.result : JSON.stringify(e.result ?? ''),
        })
        break

      case 'files-changed':
        // dsh 自己 emit 的文件改动事件(如果有)
        const filesArr = e.files
        if (Array.isArray(filesArr)) {
          for (const f of filesArr) modifiedFiles.add(f as string)
          this.emit('files-changed', { taskId, files: filesArr })
        }
        break

      case 'status':
        logger.debug({ status: e.status, message: e.message }, 'dsh status')
        break

      case 'error':
        logger.error({ error: e.error }, 'dsh error')
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
    const lines: string[] = []

    lines.push(`【会议任务 #${task.id.slice(0, 6)}】`)
    lines.push('')
    lines.push('## 需求')
    lines.push(task.requirement.interpreted)
    lines.push('')

    if (task.llm?.target) {
      lines.push('## 操作对象')
      lines.push(task.llm.target)
      lines.push('')
    }

    if (task.completions?.autoFilled && task.completions.autoFilled.length > 0) {
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
