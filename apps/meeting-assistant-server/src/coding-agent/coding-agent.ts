/**
 * CodingAgent - AI 自主改代码
 *
 * 不依赖 dsh,直接调用 MiniMax CN(Anthropic 兼容)API + tool use。
 *
 * LLM streaming responses are loosely-typed JSON; we narrow per delta/event.
 *
 * 流程:
 *   1. 接收任务(从 Scheduler)
 *   2. 构建 system prompt(AI 是代码执行者,不是判断者)
 *   3. 调用 LLM,声明可用工具(read_file/edit_file/bash)
 *   4. 循环处理 tool_use → 执行工具 → 返回结果 → LLM 继续
 *   5. emit 每个事件到前端(思考、工具调用、结果)
 *   6. 完成或失败 → emit task-complete
 *
 * 工具定义遵循 Anthropic tool use schema
 */
import { EventEmitter } from 'events'
import { promises as fs } from 'fs'
import { join } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { logger } from '../logger.js'
import type { Task } from '../types/task.js'

const execAsync = promisify(exec)

/** Anthropic Messages 响应的最小形状 */
interface LlmResponse {
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: ToolUseInput }>
}

/** Anthropic tool_use 块的最小形状 */
interface ToolUseInput {
  path?: string
  old_string?: string
  new_string?: string
  content?: string
  command?: string
  timeout?: number
  pattern?: string
  [k: string]: unknown
}

interface ToolUseLike {
  name: string
  input: ToolUseInput
  id: string
}

// ===== Tool 定义(Anthropic tool use schema) =====

const TOOLS = [
  {
    name: 'read_file',
    description: '读取项目中的文件内容,理解现有代码',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '相对项目根目录的文件路径,例如 src/components/Button.tsx',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'edit_file',
    description: '精确替换文件中的代码块(用 old_string 定位,new_string 替换)',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对项目根目录的文件路径' },
        old_string: { type: 'string', description: '要替换的原始代码块(必须完全匹配)' },
        new_string: { type: 'string', description: '替换后的代码块' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'write_file',
    description: '创建新文件或完全覆盖已有文件',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对项目根目录的文件路径' },
        content: { type: 'string', description: '完整的文件内容' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'bash',
    description: '执行 shell 命令。常用:pnpm lint / pnpm type-check / pnpm test / git diff',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要运行的 shell 命令' },
        timeout: { type: 'number', description: '超时时间(毫秒),默认 60000' },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_files',
    description: '列出目录下的文件,用于了解项目结构',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径(相对项目根)' },
        pattern: { type: 'string', description: 'glob 模式,如 *.tsx' },
      },
    },
  },
]

// ===== CodingAgent =====

export interface CodingAgentConfig {
  apiKey: string
  baseUrl: string
  model: string
  projectPath: string
  /** 最大工具调用轮次,防止无限循环 */
  maxRounds?: number
}

export class CodingAgent extends EventEmitter {
  private config: CodingAgentConfig
  private maxRounds: number

  constructor(config: CodingAgentConfig) {
    super()
    this.config = config
    this.maxRounds = config.maxRounds ?? 50
  }

  /**
   * 执行 task:主入口
   * 整个过程通过 EventEmitter 推给前端
   */
  async execute(task: Task): Promise<{ success: boolean; modifiedFiles: string[]; error?: string }> {
    const startTime = Date.now()
    const modifiedFiles = new Set<string>()
    const taskId = task.id  // 捕获到闭包

    logger.info({
      taskId: task.id,
      project: this.config.projectPath,
    }, 'CodingAgent start')

    // 1. 构建 system prompt + user message
    const systemPrompt = this.buildSystemPrompt()
    const userMessage = this.buildUserMessage(task)

    // 2. 对话历史
    const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
      { role: 'user', content: userMessage },
    ]

    let round = 0
    while (round < this.maxRounds) {
      round++

      // 3. 调用 LLM
      const response = await this.callLLM(systemPrompt, messages)

      if (!response) {
        const error = 'LLM call failed'
        this.emit('task-complete', false, { error, modifiedFiles: Array.from(modifiedFiles) })
        return { success: false, modifiedFiles: [], error }
      }

      // 4. 提取文本 + 工具调用
      const textBlocks = response.content.filter((b: { type: string; text?: string }) => b.type === 'text')
      const toolUses = response.content.filter((b: { type: string; text?: string }) => b.type === 'tool_use')

      // 推送 AI 思考文本
      for (const block of textBlocks) {
        this.emit('text-delta', { taskId, delta: block.text })
      }

      // 把 assistant message 加入历史
      messages.push({ role: 'assistant', content: response.content })

      // 5. 如果没有 tool_use,任务结束
      if (toolUses.length === 0) {
        const duration = Date.now() - startTime
        logger.info({ taskId: task.id, duration, round }, 'CodingAgent done (no tool)')
        this.emit('task-complete', true, { modifiedFiles: Array.from(modifiedFiles), duration })
        return { success: true, modifiedFiles: Array.from(modifiedFiles) }
      }

      // 6. 执行每个 tool_use(content 子集收窄为 ToolUseLike)
      const toolResults: unknown[] = []
      for (const rawToolUse of toolUses) {
        const toolUse: ToolUseLike = {
          name: rawToolUse.name ?? 'unknown',
          input: rawToolUse.input ?? {},
          id: rawToolUse.id ?? '',
        }
        const result = await this.executeTool(toolUse, taskId)

        // 记录修改的文件
        if (['edit_file', 'write_file'].includes(toolUse.name)) {
          const modifiedPath = toolUse.input.path
          if (modifiedPath && !modifiedFiles.has(modifiedPath)) {
            modifiedFiles.add(modifiedPath)
            // 推送文件变更事件(让前端刷新 iframe)
            this.emit('files-changed', {
              taskId,
              files: [modifiedPath],
            })
          }
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
          is_error: result.startsWith('Error:'),
        })
      }

      // 7. 把 tool result 加入历史
      messages.push({ role: 'user', content: toolResults })
    }

    const error = `Max rounds ${this.maxRounds} exceeded`
    logger.warn({ taskId: task.id }, error)
    this.emit('task-complete', false, { error, modifiedFiles: Array.from(modifiedFiles) })
    return { success: false, modifiedFiles: Array.from(modifiedFiles), error }
  }

  // ===== 私有方法 =====

  private buildSystemPrompt(): string {
    return `你是会议需求的代码执行助手。

# 角色
你接收的是来自"AI 自主会议助手"的明确任务。任务已经过:
- 用户已表达需求
- 已多次确认
- AI 评估为可行
- 在允许范围内(前端原型)
- 风险已评估
- 必要细节已自动补全

**不要再质疑任务,直接执行。**

# 工作流程
1. \`list_files\` 或 \`read_file\` 了解现状
2. \`edit_file\` 或 \`write_file\` 精确修改
3. \`bash\` 跑 lint/type-check/test 验证
4. 报告结果

# 硬约束
- 只改前端原型(组件/页面/样式/CRUD)
- 不允许改: 路由、权限、第三方依赖、数据模型
- 不允许跑: rm -rf、drop、git push --force
- 失败立即停止,不要盲目重试
- 改完必须跑验证

# 输出风格
- 简洁,不啰嗦
- 直接动手,不要问问题
- **每个文件改完就继续,不要回头优化已完成的代码**
- 完成时说"✅ 完成,改了哪些文件"
- 最多调用 8 个工具,达到目标就停止`
  }

  private buildUserMessage(task: Task): string {
    const lines: string[] = []
    lines.push(`【会议任务 ${task.id}】`)
    lines.push('')
    lines.push('【需求】')
    lines.push(task.requirement.interpreted)
    lines.push('')

    if (task.source.transcript.length > 0) {
      lines.push('【原话】')
      for (const seg of task.source.transcript) {
        lines.push(`[${seg.speaker}] ${seg.text}`)
      }
      lines.push('')
    }

    if (task.completions.autoFilled.length > 0) {
      lines.push('【AI 已自主补全的细节】')
      for (const c of task.completions.autoFilled) {
        lines.push(`- ${c.field}: ${c.value} (理由: ${c.reason})`)
      }
      lines.push('')
    }

    if (task.feasibility.codeMapRefs.length > 0) {
      lines.push('【涉及代码】')
      for (const ref of task.feasibility.codeMapRefs) {
        lines.push(`- ${ref}`)
      }
      lines.push('')
    }

    lines.push('【开始执行】')
    return lines.join('\n')
  }

  private async callLLM(systemPrompt: string, messages: unknown[]): Promise<LlmResponse | null> {
    try {
      const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 8192,
          system: systemPrompt,
          tools: TOOLS,
          messages,
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        logger.error({ status: response.status, errText: errText.slice(0, 500) }, 'MiniMax API error')
        return null
      }

      return await response.json() as LlmResponse
    } catch (err) {
      logger.error({ err }, 'LLM call exception')
      return null
    }
  }

  private async executeTool(toolUse: ToolUseLike, taskId: string): Promise<string> {
    const { name, input, id } = toolUse

    // 推送工具调用事件
    this.emit('tool-call', {
      taskId: taskId,
      callId: id,
      name,
      args: input,
    })

    logger.info({ tool: name, args: input }, 'tool call')

    let result: string

    try {
      switch (name) {
        case 'read_file':
          result = input.path
            ? await this.toolReadFile(input.path)
            : 'Error: path required'
          break
        case 'edit_file':
          result = (input.path && input.old_string !== undefined && input.new_string !== undefined)
            ? await this.toolEditFile(input.path, input.old_string, input.new_string)
            : 'Error: path/old_string/new_string required'
          break
        case 'write_file':
          result = (input.path && input.content !== undefined)
            ? await this.toolWriteFile(input.path, input.content)
            : 'Error: path/content required'
          break
        case 'bash':
          result = input.command
            ? await this.toolBash(input.command, input.timeout)
            : 'Error: command required'
          break
        case 'list_files':
          result = await this.toolListFiles(input.path ?? '.', input.pattern)
          break
        default:
          result = `Error: Unknown tool ${name}`
      }
    } catch (err) {
      result = `Error: ${err instanceof Error ? err.message : String(err)}`
    }

    // 推送工具结果
    this.emit('tool-result', {
      taskId: taskId,
      callId: id,
      result,
    })

    return result
  }

  // ===== 具体工具实现 =====

  private resolvePath(p: string): string {
    // 允许绝对路径,否则相对项目根
    if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) {
      return p
    }
    return join(this.config.projectPath, p)
  }

  private isPathSafe(p: string): boolean {
    // 不允许跑到项目外
    const resolved = this.resolvePath(p)
    const projectRoot = this.config.projectPath
    return resolved.startsWith(projectRoot)
  }

  private async toolReadFile(path: string): Promise<string> {
    if (!this.isPathSafe(path)) return 'Error: 路径必须在项目内'
    const full = this.resolvePath(path)
    try {
      const content = await fs.readFile(full, 'utf-8')
      // 文件太长的截断
      if (content.length > 30000) {
        return content.slice(0, 30000) + '\n\n... (文件截断,共 ' + String(content.length) + ' 字符)'
      }
      return content
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : '文件读取失败'}`
    }
  }

  private async toolEditFile(path: string, oldString: string, newString: string): Promise<string> {
    if (!this.isPathSafe(path)) return 'Error: 路径必须在项目内'
    const full = this.resolvePath(path)
    try {
      const content = await fs.readFile(full, 'utf-8')

      if (!content.includes(oldString)) {
        return 'Error: 找不到 old_string。请用 read_file 重新读取,确保 old_string 完全匹配。'
      }

      const newContent = content.replace(oldString, newString)
      await fs.writeFile(full, newContent, 'utf-8')

      return `✅ 已修改 ${path}`
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : '修改失败'}`
    }
  }

  private async toolWriteFile(path: string, content: string): Promise<string> {
    if (!this.isPathSafe(path)) return 'Error: 路径必须在项目内'
    const full = this.resolvePath(path)
    try {
      const dir = full.substring(0, full.lastIndexOf('\\') >= 0 ? full.lastIndexOf('\\') : full.lastIndexOf('/'))
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(full, content, 'utf-8')
      return `✅ 已写入 ${path} (${content.length} 字符)`
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : '写入失败'}`
    }
  }

  private async toolBash(command: string, timeout = 60000): Promise<string> {
    // 安全检查:禁止危险命令
    const dangerous = ['rm -rf', 'rm -fr', 'drop table', 'git push --force', 'del /f /q']
    if (dangerous.some(d => command.toLowerCase().includes(d))) {
      return `Error: 危险命令被拒绝: ${command}`
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.config.projectPath,
        timeout,
        maxBuffer: 1024 * 1024,
      })
      const out = (stdout + stderr).slice(0, 5000)
      return out || '(无输出)'
    } catch (err: unknown) {
      const execErr = err as { code?: number; message?: string; stdout?: string }
      return `Error: 命令失败 (exit ${execErr.code}): ${(execErr.message || '').slice(0, 1000)}\n${(execErr.stdout || '').slice(0, 2000)}`
    }
  }

  private async toolListFiles(path: string, pattern?: string): Promise<string> {
    const dir = this.resolvePath(path || '.')
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const filtered = entries
        .filter(e => !['node_modules', '.git', 'dist', '.next', '.turbo'].includes(e.name))
        .filter(e => !pattern || new RegExp(pattern.replace(/\*/g, '.*')).test(e.name))
        .map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`)

      return filtered.join('\n') || '(空目录)'
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : '目录读取失败'}`
    }
  }
}
