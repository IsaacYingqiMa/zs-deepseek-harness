/**
 * WebSocket API: 任务事件流
 *
 * WS /ws/events - 订阅所有 JudgmentEvent
 * 浏览器连这个端点,实时接收 task 状态变化 + AI 思考流 + dsh 执行细节
 */
import type { WebSocket } from 'ws'
import type { JudgmentEngine } from '../judgment/judgment-engine.js'
import { logger } from '../logger.js'

export class EventsWs {
  private clients: Set<WebSocket> = new Set()

  constructor(private engine: JudgmentEngine) {
    // 监听引擎事件,广播给所有客户端
    this.engine.on((event) => {
      for (const client of this.clients) {
        this.send(client, event)
      }
    })
  }

  /** 处理新连接 */
  handle(ws: WebSocket): void {
    this.clients.add(ws)
    logger.info({ count: this.clients.size }, 'WS events client connected')

    // 发送初始状态
    const initial = this.engine.getInitialState()
    this.send(ws, { type: 'initial/state', data: initial })

    ws.on('close', () => {
      this.clients.delete(ws)
      logger.info({ count: this.clients.size }, 'WS events client disconnected')
    })

    ws.on('error', (err) => {
      logger.warn({ err }, 'WS events client error')
      this.clients.delete(ws)
    })
  }

  private send(ws: WebSocket, event: unknown): void {
    try {
      if (ws.readyState === 1) { // OPEN
        ws.send(JSON.stringify(event))
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to send WS event')
    }
  }
}
