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
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
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
  /** 当前 task 的项目路径(每次 execute() 设置一次,供 buildPrompt 读 AIPROMPT.md) */
  private currentProjectPath = ''

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

    // 0. 设置当前 projectPath(供 buildPrompt 读 AIPROMPT.md 用)
    this.currentProjectPath = projectPath || ''

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

        // 记录文件改动(扩展工具名以兼容 dsh / 不同 LLM 工具)
        // ★ dsh headless 实际用的工具名是 'edit' / 'write'(不带 _file 后缀)
        if (
          ['edit_file', 'write_file', 'multi_edit', 'str_replace', 'create_file', 'fs_write', 'str_replace_based_edit_tool',
            'edit', 'write'].includes(toolName)
        ) {
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

    // ★★★ 项目级 AI 改造指南(项目自带 AIPROMPT.md,优先级最高)★★★
    // 模板项目(工单 / 大屏)的 AIPROMPT.md 写明:可改区 / 不可改区 / 改造示例 / 硬约束
    // dsh 必须严格遵守,这是 demo 稳定的基石
    const aiPromptPath = join(this.currentProjectPath, 'AIPROMPT.md')
    if (existsSync(aiPromptPath)) {
      try {
        const projectGuide = readFileSync(aiPromptPath, 'utf-8')
        lines.push('# 📋 项目级 AI 改造指南(项目自带,优先级最高)')
        lines.push('')
        lines.push('```')
        lines.push(projectGuide)
        lines.push('```')
        lines.push('')
        lines.push('---')
        lines.push('')
        logger.info({ aiPromptPath, bytes: projectGuide.length }, 'AIPROMPT.md injected into dsh prompt')
      } catch (err) {
        logger.warn({ err, aiPromptPath }, 'failed to read AIPROMPT.md')
      }
    } else {
      lines.push('⚠️ 警告:项目根目录没有 AIPROMPT.md。请谨慎修改,只改 .html / .css / .js,不要碰架构。')
      lines.push('')
    }

    lines.push('⚡ 这是一个简单任务(纯 HTML 文件修改),不要过多思考或分析,直接动手。')
    lines.push('')

    // ★★★ 项目运行机制说明(让 dsh 知道系统怎么跟它配合)★★★
    lines.push('## 🔧 项目运行机制(必读,避免乱改)')
    lines.push('')
    lines.push('### 版本号机制')
    lines.push('- 系统会在每次你修改文件后,**自动给项目根目录的 `data/version.json` +1**')
    lines.push('- 这个文件用来在前端显示"v5"、"v6" 这种版本徽章,告诉用户改了多少次')
    lines.push('- **绝对不要手动改 `data/version.json`** — 系统会自己写,你改了会被覆盖还会乱')
    lines.push('- 改完后**不需要**手动去更新版本号,系统自动跟踪')
    lines.push('')
    lines.push('### iframe 自动刷新')
    lines.push('- 你改完文件后,**系统会自动重新加载左侧预览 iframe**')
    lines.push('- 你不需要自己刷新页面,改完就直接结束即可')
    lines.push('- 如果你需要"验证修改效果",**不要**跑 bash 命令,直接 list_files 看看改后的内容就够了')
    lines.push('')
    lines.push('### AIPROMPT.md 是规则不是文件')
    lines.push('- 上面的 AIPROMPT.md 是"项目改造规则",你**已经读到了**(它在 prompt 里)')
    lines.push('- 不要 `read_file AIPROMPT.md` — 它不在项目里,读了会报错')
    lines.push('- 直接按上面的"可改区"/"不可改区"开始动手')
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
    lines.push('1. **已经读过 AIPROMPT.md 了**(在 prompt 顶部)→ 知道哪些可改/不可改')
    lines.push('2. list_files → 看 HTML 文件(只看 1-2 个相关文件)')
    lines.push('3. read_file → 读取目标 HTML')
    lines.push('4. edit_file → 修改 HTML 标签/属性/内容(只改可改区!)')
    lines.push('5. **自我确认清单**(改完后在心里检查):')
    lines.push('   - 我改的文件都在 AIPROMPT.md 的"可改区"里吗?')
    lines.push('   - 我没碰 `data/version.json` / `index.html` 框架 / `js/app.js` 路由吧?')
    lines.push('   - 改动能让用户需求直接满足吗?')
    lines.push('6. 完成 → 回复 "✅ 完成 + [改动文件列表]",然后结束')
    lines.push('')

    lines.push('## 约束(必读)')
    lines.push('- **严格遵守 AIPROMPT.md 里的"可改区"和"不可改区"**')
    lines.push('- 只改 .html / .css / .js 文件')
    lines.push('- **禁止**:pnpm install / lint / build / dev')
    lines.push('- **禁止**:新建依赖(package.json 不变)')
    lines.push('- **最多 4-5 个工具调用**就应完成')
    lines.push('- 失败立即停止,不要盲目重试')
    lines.push('')

    // ★★★ 防"什么都没改"陷阱 ★★★
    lines.push('## ⚠️ 重要:必须真的改文件')
    lines.push('- 用户的需求可能听起来模糊(比如"加点数据"、"再好看点")')
    lines.push('- **不要** 因为需求模糊就什么都不做')
    lines.push('- **不要** 在分析阶段花超过 1 个工具调用')
    lines.push('- 模糊需求的处理方式:')
    lines.push('  - "加点数据" → 在 js/data.js 的对应数组里**加 1-2 个新条目**')
    lines.push('  - "再好看点" → 在 css/theme.css 里**微调 1-2 个颜色变量**')
    lines.push('  - "加个 X 功能" → 加 1 个最小的、最直接的实现(不要做大而全)')
    lines.push('- **任务完成的硬标准**:至少调用了 1 次 edit_file 或 write_file')
    lines.push('- 如果你最终没有调用 edit_file / write_file,**任务就是失败的**')
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
