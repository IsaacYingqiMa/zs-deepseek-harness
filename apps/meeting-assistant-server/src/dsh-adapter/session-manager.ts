/**
 * dsh Session 管理器
 *
 * 职责:
 *   1. 创建 dsh session(指定 preset)
 *   2. 维护 session ID
 *   3. 给 session 发 prompt
 *   4. 暴露事件给其他模块
 *
 * 注意:这是对接 dsh 后端的核心。
 *
 * dsh 后端启动: `pnpm dsh web` (默认 :3080)
 * dsh 的 HTTP API 通过 @anthropic-ai/sdk 的 message format 通信。
 *
 * dsh streaming events are deliberately typed as unknown at the boundary
 * because they cross an SDK seam; the receiving layer narrows per event.
 */
/* eslint-disable typescript/no-unsafe-assignment,
   typescript/no-unsafe-member-access,
   typescript/use-unknown-in-catch-callback-variable */
import { EventEmitter } from 'events'
import { logger } from '../logger.js'
import type { Task } from '../types/task.js'

export interface DshSessionConfig {
  baseUrl: string
  preset: string
  cwd?: string
  model?: string
}

export class DshAdapter extends EventEmitter {
  private sessionId: string | null = null
  private config: DshSessionConfig
  /** 是否处于 mock 模式(dsh 不可用时降级) */
  private mockMode = false

  constructor(config: DshSessionConfig) {
    super()
    this.config = config
  }

  /** 创建 dsh session */
  async createSession(): Promise<string> {
    logger.info({
      baseUrl: this.config.baseUrl,
      preset: this.config.preset,
    }, 'Creating dsh session')

    try {
      const response = await fetch(`${this.config.baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preset: this.config.preset,
          cwd: this.config.cwd,
          model: this.config.model || 'claude-sonnet-4-5',
        }),
      })

      if (!response.ok) {
        throw new Error(`dsh session create failed: ${response.status} ${await response.text()}`)
      }

      const data = await response.json() as { sessionId: string }
      this.sessionId = data.sessionId
      this.mockMode = false

      logger.info({ sessionId: this.sessionId }, 'dsh session created')
      return this.sessionId
    } catch (err) {
      logger.error({ err }, 'Failed to create dsh session, falling back to MOCK mode')
      // 演示模式:即使 dsh 不可用也允许运行(mock)
      this.sessionId = `mock-${Date.now()}`
      this.mockMode = true
      return this.sessionId
    }
  }

  /** 是否处于 mock 模式 */
  isMockMode(): boolean {
    return this.mockMode
  }

  /** 销毁 session */
  async destroySession(): Promise<void> {
    if (!this.sessionId) return
    try {
      await fetch(`${this.config.baseUrl}/api/sessions/${this.sessionId}`, {
        method: 'DELETE',
      })
    } catch (err) {
      logger.warn({ err }, 'Failed to destroy dsh session')
    }
    this.sessionId = null
  }

  /** 获取 sessionId */
  getSessionId(): string | null {
    return this.sessionId
  }

  /** 执行 task:把 task 转成 dsh 能理解的指令,发过去,订阅 SSE */
  async executeTask(task: Task): Promise<void> {
    if (!this.sessionId) {
      throw new Error('dsh session not initialized')
    }

    // 如果是 mock 模式,模拟执行过程
    if (this.mockMode) {
      logger.info({ taskId: task.id }, 'MOCK execution (dsh unavailable)')
      this.simulateMockExecution(task)
      return
    }

    const instruction = this.buildInstruction(task)

    logger.info({
      taskId: task.id,
      instruction: instruction.substring(0, 100) + '...',
    }, 'Sending task to dsh')

    // 1. 发 prompt
    const response = await fetch(
      `${this.config.baseUrl}/api/sessions/${this.sessionId}/prompt`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: [{ type: 'text', text: instruction }],
        }),
      },
    )

    if (!response.ok) {
      const err = await response.text()
      // dsh 不可用时降级为 mock
      if (response.status === 401 || response.status === 404 || response.status >= 500) {
        logger.warn({ status: response.status }, 'dsh unavailable, switching to MOCK')
        this.mockMode = true
        this.simulateMockExecution(task)
      } else {
        this.emit('task-complete', false, `dsh prompt failed: ${err}`)
      }
      return
    }

    const { requestId } = await response.json() as { requestId: string }

    // 2. 订阅 SSE 事件流
    this.subscribeSse(this.sessionId, requestId, task.id)
  }

  /**
   * 模拟 dsh 执行(没有真实 dsh 时用)
   * 产生假的工具调用 + 完成事件,前端能看到完整流程
   */
  private simulateMockExecution(task: Task): void {
    const taskId = task.id
    const startTime = Date.now()

    // 模拟几个工具调用
    const mockTools = [
      { name: 'bash', args: { command: 'cat package.json' }, delay: 300 },
      { name: 'read_file', args: { path: 'src/App.tsx' }, delay: 500 },
      { name: 'edit_file', args: { path: 'src/App.tsx', new: '...' }, delay: 800 },
      { name: 'bash', args: { command: 'pnpm lint' }, delay: 600 },
    ]

    let i = 0
    const next = () => {
      if (i >= mockTools.length) {
        // 完成
        this.emit('task-complete', true)
        logger.info({
          taskId,
          duration: Date.now() - startTime,
        }, 'MOCK task completed')
        return
      }

      const tool = mockTools[i++]
      const callId = `mock-call-${i}`

      // 工具调用开始
      this.emit('tool-call', {
        taskId,
        callId,
        name: tool.name,
        args: tool.args,
      })

      // 工具调用结束
      setTimeout(() => {
        this.emit('tool-result', {
          taskId,
          callId,
          result: { success: true, mock: true },
        })
        // 下一步
        setTimeout(next, 200)
      }, tool.delay)
    }

    // 启动 mock 流程
    setTimeout(next, 200)
  }

  /** 把 Task 转成 dsh 指令(结构化) */
  private buildInstruction(task: Task): string {
    const lines: string[] = []

    lines.push(`【会议任务 #${task.id}】用户已讨论并通过了一个需求,请执行。`)
    lines.push('')
    lines.push('【需求描述】')
    lines.push(task.requirement.interpreted)
    lines.push('')
    lines.push('【原话参考】')
    lines.push(task.source.transcript.map(s => `[${s.speaker}] ${s.text}`).join('\n'))
    lines.push('')

    if (task.completions.autoFilled.length > 0) {
      lines.push('【AI 已自主补全的细节】')
      for (const c of task.completions.autoFilled) {
        lines.push(`- ${c.field}: ${c.value} (理由: ${c.reason})`)
      }
      lines.push('')
    }

    if (task.feasibility.codeMapRefs.length > 0) {
      lines.push('【涉及代码位置】')
      for (const ref of task.feasibility.codeMapRefs) {
        lines.push(`- ${ref}`)
      }
      lines.push('')
    }

    lines.push('【约束 - 必须遵守】')
    lines.push('- 工作量 < 5 分钟')
    lines.push('- 不允许改: 路由 / 权限 / 第三方依赖 / 数据模型')
    lines.push('- 只改前端原型相关文件')
    lines.push('- 改完必须跑 lint + type check')
    lines.push('- 失败立即停止,不要盲目重试')
    lines.push('')
    lines.push('【执行步骤】')
    lines.push('1. 读相关文件,理解现有代码')
    lines.push('2. 修改文件')
    lines.push('3. 跑 lint / type check')
    lines.push('4. 返回结果(改了哪些文件 / 验证状态)')

    return lines.join('\n')
  }

  /** 订阅 SSE 事件流 */
  private subscribeSse(sessionId: string, requestId: string, taskId: string): void {
    const url = `${this.config.baseUrl}/api/sessions/${sessionId}/events?requestId=${requestId}`
    logger.info({ url }, 'Subscribing to dsh SSE')

    // 用 fetch + ReadableStream 解析 SSE(浏览器 EventSource 在 Node.js 不支持)
    fetch(url, {
      headers: { Accept: 'text/event-stream' },
    }).then(async (response) => {
      if (!response.ok || !response.body) {
        logger.error({ status: response.status }, 'SSE subscribe failed')
        this.emit('task-complete', false, 'SSE 订阅失败')
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = decoder.decode(value, { stream: true })
          buffer += text

          // SSE 事件以 \n\n 分隔
          let idx: number
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const eventText = buffer.substring(0, idx)
            buffer = buffer.substring(idx + 2)
            this.parseSseEvent(eventText, taskId)
          }
        }
      } catch (err) {
        logger.error({ err, taskId }, 'SSE stream error')
        this.emit('task-complete', false, err instanceof Error ? err.message : String(err))
      }
    }).catch((err) => {
      logger.error({ err, taskId }, 'Failed to subscribe SSE')
      this.emit('task-complete', false, err instanceof Error ? err.message : String(err))
    })
  }

  /** 解析一个 SSE event block */
  private parseSseEvent(block: string, taskId: string): void {
    let eventName = 'message'
    let data = ''

    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        eventName = line.substring(6).trim()
      } else if (line.startsWith('data:')) {
        data += line.substring(5).trim()
      }
    }

    if (!data) return

    try {
      const parsed = JSON.parse(data)

      switch (eventName) {
        case 'assistant/text-delta':
          this.emit('text-delta', { taskId, delta: parsed.delta })
          this.emit('execution/log', {
            taskId,
            entry: {
              at: Date.now(),
              type: 'assistant-text',
              text: parsed.delta,
            },
          })
          break

        case 'tool/call':
          this.emit('tool-call', {
            taskId,
            callId: parsed.callId,
            name: parsed.name,
            args: parsed.args,
          })
          this.emit('execution/log', {
            taskId,
            entry: {
              at: Date.now(),
              type: 'tool-call',
              toolName: parsed.name,
              toolArgs: parsed.args,
            },
          })
          break

        case 'tool/result':
          this.emit('tool-result', {
            taskId,
            callId: parsed.callId,
            result: parsed.result,
          })
          this.emit('execution/log', {
            taskId,
            entry: {
              at: Date.now(),
              type: 'tool-result',
              toolName: parsed.toolName,
              toolResult: parsed.result,
            },
          })
          break

        case 'assistant/message/end':
          logger.info({ taskId }, 'dsh assistant message end')
          this.emit('task-complete', true)
          break

        case 'assistant/error':
          logger.error({ taskId, error: parsed.error }, 'dsh error')
          this.emit('task-complete', false, parsed.error)
          break
      }
    } catch (err) {
      logger.warn({ err, data }, 'Failed to parse SSE event')
    }
  }
}
