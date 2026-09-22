/**
 * 调度器 - 把 Task 发给执行层(优先 DshHeadlessRunner,失败 fallback 到 CodingAgent)
 *
 * 策略:
 *   - 单 dsh session 串行队列
 *   - 一个 task 执行完成后,再取下一个
 *   - 如果 task 在队列中被驳回,跳过
 */
import { logger } from '../logger.js'
import type { Task, TaskSummary } from '../types/task.js'
import type { CodingAgent } from '../coding-agent/coding-agent.js'
import type { DshHeadlessRunner } from '../dsh-headless-runner/dsh-headless-runner.js'
import type { TaskQueue } from './task-queue.js'
import type { TriggerEngine } from './trigger-engine.js'


interface AgentEvent {
  taskId: string
  delta?: string
  text?: string
  callId?: string
  name?: string
  args?: unknown
  result?: unknown
  files?: string[]
}

/** JudgmentEngine 暴露给 Scheduler 的事件转发口 */
interface EventForwarder {
  emitExternal(event: unknown): void
}

export class Scheduler {
  private queue: Task[] = []
  private currentTask: Task | null = null
  private isBusy = false
  /** JudgmentEngine 事件转发口 */
  private eventEmitter: EventForwarder | null = null
  /** 项目根目录(dsh 操作的目标) */
  private projectPath: string | null = null

  constructor(
    private taskQueue: TaskQueue,
    private codingAgent: CodingAgent,
    private triggerEngine: TriggerEngine,
    private dshRunner: DshHeadlessRunner,
  ) {
    // 绑定 CodingAgent 的事件(用于 fallback 时)
    this.codingAgent.on('text-delta', (event: AgentEvent) => {
      this.forwardEvent({
        type: 'coding/thinking',
        data: { taskId: this.currentTaskId() || taskIdFromEvent(event), text: event.delta },
      })
    })
    this.codingAgent.on('tool-call', (event: AgentEvent) => {
      this.forwardEvent({
        type: 'coding/tool-call',
        data: { taskId: this.currentTaskId() || taskIdFromEvent(event), callId: event.callId, name: event.name, args: event.args },
      })
    })
    this.codingAgent.on('tool-result', (event: AgentEvent) => {
      const taskId = this.currentTaskId() || taskIdFromEvent(event)
      const resultStr = typeof event.result === 'string' ? event.result : JSON.stringify(event.result)
      this.forwardEvent({
        type: 'coding/tool-result',
        data: { taskId, callId: event.callId, result: resultStr, isError: resultStr.startsWith('Error') },
      })
    })

    // 绑定 DshHeadlessRunner 的事件(主路径)
    this.dshRunner.on('text-delta', (event: AgentEvent) => {
      this.forwardEvent({
        type: 'coding/thinking',
        data: { taskId: this.currentTaskId() || taskIdFromEvent(event), text: event.delta },
      })
    })
    this.dshRunner.on('tool-call', (event: AgentEvent) => {
      this.forwardEvent({
        type: 'coding/tool-call',
        data: { taskId: this.currentTaskId() || taskIdFromEvent(event), callId: event.callId, name: event.name, args: event.args },
      })
    })
    this.dshRunner.on('tool-result', (event: AgentEvent) => {
      const taskId = this.currentTaskId() || taskIdFromEvent(event)
      const resultStr = typeof event.result === 'string' ? event.result : JSON.stringify(event.result ?? '')
      this.forwardEvent({
        type: 'coding/tool-result',
        data: { taskId, callId: event.callId, result: resultStr, isError: resultStr.startsWith('Error') },
      })
    })
    this.dshRunner.on('files-changed', (event: AgentEvent) => {
      this.forwardEvent({
        type: 'coding/files-changed',
        data: { taskId: this.currentTaskId() || taskIdFromEvent(event), files: event.files },
      })
    })
  }

  /** 转发事件到 JudgmentEngine */
  private forwardEvent(event: unknown): void {
    this.eventEmitter?.emitExternal(event)
  }

  /** 注册事件总线 */
  setEventEmitter(ee: EventForwarder): void {
    this.eventEmitter = ee
  }

  /** Task 进入 confirmed 状态时调用 */
  onTaskConfirmed(task: Task): void {
    if (this.queue.find(t => t.id === task.id)) return

    const decision = this.triggerEngine.evaluate(task)

    if (decision.shouldReject) {
      logger.info({ taskId: task.id, reason: decision.reason }, 'Task rejected')
      this.taskQueue.setStatus(task.id, 'rejected', decision.reason)
      return
    }

    if (decision.shouldDefer) {
      logger.info({ taskId: task.id, reason: decision.reason }, 'Task deferred')
      this.taskQueue.setStatus(task.id, 'deferred', decision.reason)
      return
    }

    if (!decision.shouldExecute) {
      logger.debug({ taskId: task.id, reason: decision.reason }, 'Task not ready')
      return
    }

    this.queue.push(task)
    logger.info({
      taskId: task.id,
      queueSize: this.queue.length,
      interpreted: task.requirement.interpreted,
    }, 'Task queued for execution')

    setImmediate(() => this.tryExecuteNext())
  }

  /** 执行层完成回调(统一入口:状态落地 + 事件推送前端 + 队列推进) */
  onTaskComplete(success: boolean, error?: string, payload?: { modifiedFiles?: string[]; duration?: number }): void {
    if (!this.currentTask) {
      // double-complete 防护:事件路径和 await 返回路径可能各触发一次,
      // 第二次直接忽略(不是错误)
      logger.debug('onTaskComplete called with no current task (already handled), ignore')
      return
    }

    const task = this.currentTask
    const taskId = task.id
    const modifiedFiles = payload?.modifiedFiles ?? []
    const finishedAt = Date.now()
    const duration = payload?.duration ?? 0

    this.isBusy = false
    this.currentTask = null

    if (success) {
      this.taskQueue.setStatus(taskId, 'completed', '执行成功')
      this.taskQueue.setExecution(taskId, { finishedAt, modifiedFiles })
      logger.info({ taskId, modifiedFiles: modifiedFiles.length, duration }, 'Task execution succeeded')

      // ← 关键:推 WS 事件给前端(之前缺失,前端卡片永远停在 executing)
      this.forwardEvent({
        type: 'task/completed',
        data: { id: taskId, files: modifiedFiles, duration },
      })
      this.forwardEvent({
        type: 'task/updated',
        data: { id: taskId, changes: { status: 'completed' } },
      })
    } else {
      this.taskQueue.setStatus(taskId, 'failed', error || '执行失败')
      this.taskQueue.setExecution(taskId, { finishedAt })
      logger.warn({ taskId, error }, 'Task execution failed')

      this.forwardEvent({
        type: 'task/failed',
        data: { id: taskId, error: error || '执行失败' },
      })
      this.forwardEvent({
        type: 'task/updated',
        data: { id: taskId, changes: { status: 'failed' } },
      })
    }

    // 推送最新队列状态(执行中指示器切换)
    this.forwardEvent({
      type: 'queue/state',
      data: this.getQueueState(),
    })

    setImmediate(() => this.tryExecuteNext())
  }

  /** 强制取消队列中的某个 task */
  cancel(taskId: string): boolean {
    const idx = this.queue.findIndex(t => t.id === taskId)
    if (idx >= 0) {
      this.queue.splice(idx, 1)
      this.taskQueue.setStatus(taskId, 'rejected', '用户手动取消')
      logger.info({ taskId }, 'Task cancelled from queue')
      return true
    }
    return false
  }

  getQueueState(): { queue: TaskSummary[]; current: TaskSummary | null } {
    const toSummary = (t: Task): TaskSummary =>
      this.taskQueue.getSummary(t.id) ?? {
        id: t.id,
        status: t.status,
        interpreted: t.requirement.interpreted,
        intent: t.requirement.intent,
        mentionCount: t.source.mentionCount,
        speakers: t.source.speakers,
        feasibility: t.feasibility,
      }
    return {
      queue: this.queue.map(toSummary),
      current: this.currentTask ? toSummary(this.currentTask) : null,
    }
  }

  private currentTaskId(): string | null {
    return this.currentTask?.id ?? null
  }

  private codingAgentModifiedFiles(): string[] {
    // TODO: 跟踪修改的文件
    return []
  }

  private async tryExecuteNext(): Promise<void> {
    if (this.isBusy || this.queue.length === 0) return

    const next = this.queue.shift()
    if (!next) return
    const refreshed = this.taskQueue.get(next.id)
    if (!refreshed) {
      setImmediate(() => this.tryExecuteNext())
      return
    }

    if (['rejected', 'failed'].includes(refreshed.status)) {
      setImmediate(() => this.tryExecuteNext())
      return
    }

    this.currentTask = refreshed
    this.isBusy = true
    this.taskQueue.setStatus(refreshed.id, 'executing', '执行中')

    logger.info({
      taskId: refreshed.id,
      interpreted: refreshed.requirement.interpreted,
      queueRemaining: this.queue.length,
      projectPath: refreshed.source.currentChunkId ? '(unknown)' : 'projectRoot',
    }, 'Executing task via DshHeadlessRunner (with CodingAgent fallback)')

    try {
      // 主路径:dsh headless
      const projectPath = this.projectPath ?? undefined
      type ExecResult = { success: boolean; modifiedFiles: string[]; error?: string; duration?: number }
      const result: ExecResult = await this.dshRunner.execute(refreshed, projectPath)
      // 完成处理(状态落地 + WS 推送)统一在 onTaskComplete;
      // 注意事件路径可能已先处理,double-complete 防护会自动忽略本次
      this.onTaskComplete(result.success, result.error, {
        modifiedFiles: result.modifiedFiles,
        duration: result.duration,
      })
    } catch (dshErr) {
      logger.warn({
        err: dshErr,
        taskId: refreshed.id,
      }, 'dsh headless failed, falling back to CodingAgent')

      try {
        // fallback:自研 CodingAgent
        await this.codingAgent.execute(refreshed)
        // CodingAgent 自己 emit task-complete
      } catch (fallbackErr) {
        logger.error({ err: fallbackErr, taskId: refreshed.id }, 'CodingAgent fallback also failed')
        this.onTaskComplete(false, fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr))
      }
    }
  }

  /** 设置项目根目录(ProjectsApi 调用) */
  setProjectPath(path: string): void {
    this.projectPath = path
    logger.info({ projectPath: path }, 'Scheduler projectPath set')
  }
}

// 辅助函数
function taskIdFromEvent(event: AgentEvent): string {
  return event.taskId || 'unknown'
}
