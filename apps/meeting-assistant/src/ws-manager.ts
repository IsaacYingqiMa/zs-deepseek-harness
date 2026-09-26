/**
 * WebSocket 单例管理器
 *
 * 设计:WS 生命周期脱离 React,避免 StrictMode / HMR 反复 cleanup 导致的断连。
 *
 * - 模块级单例
 * - 自动重连(指数退避)
 * - 多 listener 支持
 */
type EventListener = (data: unknown) => void
type StateListener = (state: 'connecting' | 'open' | 'closed') => void

interface WsManagerOptions {
  url: string
  /** 重连最大次数(默认 5) */
  maxReconnect?: number
  /** 心跳间隔 ms(默认 30000) */
  heartbeatMs?: number
}

export class WsManager {
  private ws: WebSocket | null = null
  private eventListeners = new Set<EventListener>()
  private stateListeners = new Set<StateListener>()
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private manuallyClosed = false
  private state: 'connecting' | 'open' | 'closed' = 'closed'

  constructor(private options: WsManagerOptions) {}

  /** 启动连接(多次调用幂等,只在没连上时建新 WS) */
  start(): void {
    this.manuallyClosed = false
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    this.connect()
  }

  /** 彻底关闭(组件卸载时调用,但默认不主动 close,让 WS 自然活着) */
  stop(): void {
    this.manuallyClosed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onclose = null
      this.ws.onerror = null
      try { this.ws.close() } catch {}
      this.ws = null
    }
  }

  /** 主动发送 */
  send(data: unknown): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(typeof data === 'string' ? data : JSON.stringify(data))
      return true
    }
    return false
  }

  /** 是否已连接 */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /** 订阅消息 */
  on(listener: EventListener): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  /** 订阅状态 */
  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener)
    listener(this.state)
    return () => this.stateListeners.delete(listener)
  }

  private setState(s: 'connecting' | 'open' | 'closed') {
    this.state = s
    for (const l of this.stateListeners) {
      try { l(s) } catch {}
    }
  }

  private connect() {
    if (this.manuallyClosed) return

    this.setState('connecting')

    let ws: WebSocket
    try {
      ws = new WebSocket(this.options.url)
    } catch (err) {
      console.warn(`[WS] create failed: ${this.options.url}`, err)
      this.scheduleReconnect()
      return
    }

    this.ws = ws

    ws.onopen = () => {
      console.log(`[WS] connected: ${this.options.url}`)
      this.reconnectAttempts = 0
      this.setState('open')
      this.startHeartbeat()
    }

    ws.onmessage = (e) => {
      try {
        const data: unknown = JSON.parse(e.data as string)
        for (const l of this.eventListeners) {
          try { l(data) } catch (err) { console.error('listener error', err) }
        }
      } catch (err) {
        console.error('parse failed', err)
      }
    }

    ws.onclose = () => {
      console.log(`[WS] closed: ${this.options.url}`)
      this.setState('closed')
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer)
        this.heartbeatTimer = null
      }
      if (!this.manuallyClosed) this.scheduleReconnect()
    }

    ws.onerror = () => {
      console.warn(`[WS] error: ${this.options.url}`)
    }
  }

  private scheduleReconnect() {
    if (this.manuallyClosed) return
    if (this.reconnectTimer) return

    const max = this.options.maxReconnect ?? 5
    if (this.reconnectAttempts >= max) {
      console.error(`[WS] max reconnect attempts reached: ${this.options.url}`)
      return
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    const interval = this.options.heartbeatMs ?? 30000
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try { this.ws.send(JSON.stringify({ type: 'ping' })) } catch {}
      }
    }, interval)
  }
}

// ===== 单例导出 =====
const wsBase = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`

export const eventsWs = new WsManager({
  url: `${wsBase}/ws/events`,
})

export const manualInputWs = new WsManager({
  url: `${wsBase}/ws/manual-input`,
})

// 立即启动(模块加载时)
eventsWs.start()
manualInputWs.start()
