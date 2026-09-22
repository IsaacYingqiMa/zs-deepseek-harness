/**
 * FunASR WebSocket 客户端 —— 严格按官方协议
 *
 * 协议:
 *   1. 第一帧(JSON 配置):
 *      {mode, chunk_size, chunk_interval, audio_fs, wav_name, is_speaking: true, hotwords, itn}
 *   2. 后续帧(二进制 PCM Int16, 16KHz, mono)
 *   3. 停止帧(JSON):{is_speaking: false}
 *
 * 服务端响应(JSON):
 *   {text, mode: "online"|"offline"|"2pass-online"|"2pass-offline", timestamp, is_final}
 */
import { WebSocket } from 'ws'
import { logger } from '../logger.js'

export interface FunasrResult {
  text: string
  mode: 'online' | 'offline' | '2pass-online' | '2pass-offline'
  timestamp: number
  isFinal: boolean
}

export type FunasrResultListener = (result: FunasrResult) => void

export interface FunasrConfig {
  mode?: 'online' | 'offline' | '2pass'
  chunk_size?: number[]
  chunk_interval?: number
  audio_fs?: number
  wav_name?: string
  hotwords?: string
  itn?: boolean
}

export class FunasrClient {
  private ws: WebSocket | null = null
  private listeners: Set<FunasrResultListener> = new Set()
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempts = 0
  private readonly maxReconnectAttempts = 10

  constructor(
    private url: string,
    private options: {
      autoReconnect?: boolean
      reconnectDelay?: number
    } = {},
  ) {}

  /** 连接到 FunASR */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info({ url: this.url }, 'Connecting to FunASR')

      try {
        this.ws = new WebSocket(this.url, {
          perMessageDeflate: false,
          rejectUnauthorized: false,
        })
      } catch (err) {
        reject(err)
        return
      }

      this.ws.on('open', () => {
        logger.info('FunASR connected')
        resolve()
      })

      this.ws.on('error', (err) => {
        logger.error({ err: err.message }, 'FunASR error')
      })

      this.ws.on('message', (data: Buffer) => {
        try {
          const text = data.toString()
          const parsed = JSON.parse(text)
          this.handleResult(parsed)
        } catch (err) {
          logger.warn({ err }, 'Failed to parse FunASR message')
        }
      })

      this.ws.on('close', () => {
        logger.warn('FunASR connection closed')
        this.ws = null
        if (this.options.autoReconnect) {
          this.scheduleReconnect()
        }
      })
    })
  }

  /** 发送配置帧(JSON 第一帧) */
  sendConfig(config: FunasrConfig): void {
    if (!this.isConnected()) {
      logger.warn('FunASR not connected, dropping config')
      return
    }
    this.ws?.send(JSON.stringify(config))
    logger.info({ config }, 'FunASR config sent')
  }

  /** 发送 PCM 二进制帧 */
  sendPcm(pcmBuffer: Buffer): void {
    if (!this.isConnected()) {
      // 不打 warn,正常情况(用户在录音前/后 WS 可能断开)
      return
    }
    this.ws?.send(pcmBuffer)
  }

  /** 发送结束帧({is_speaking: false}) */
  sendEndFrame(): void {
    if (!this.isConnected()) {
      logger.warn('FunASR not connected, dropping end frame')
      return
    }
    this.ws?.send(JSON.stringify({ is_speaking: false }))
    logger.info('FunASR end frame sent')
  }

  /** 是否已连接 */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /** 关闭连接 */
  close(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  /** 订阅识别结果 */
  on(listener: FunasrResultListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // ===== 私有 =====

  private handleResult(parsed: Record<string, unknown>): void {
    // FunASR 输出:
    //   {text, mode, timestamp, is_final, wav_name, ...}
    const rawText = parsed.text
    const rawNested = parsed.result
    const nested = (typeof rawNested === 'object' && rawNested !== null
      ? (rawNested as Record<string, unknown>).text
      : undefined) as string | undefined
    const text = typeof rawText === 'string' ? rawText : (nested ?? '')
    if (!text) return

    const rawMode = parsed.mode
    const mode = (typeof rawMode === 'string' ? rawMode
      : (parsed.is_final ? 'offline' : 'online')) as FunasrResult['mode']
    const isFinal = mode === 'offline' || mode === '2pass-offline' || parsed.is_final === true

    const rawTs = parsed.timestamp
    const ts = typeof rawTs === 'string' || typeof rawTs === 'number' ? new Date(rawTs).getTime() : Date.now()

    const result: FunasrResult = {
      text,
      mode,
      timestamp: rawTs ? ts : Date.now(),
      isFinal,
    }

    for (const listener of this.listeners) {
      try {
        listener(result)
      } catch (err) {
        logger.error({ err }, 'FunASR listener error')
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error({ attempts: this.reconnectAttempts }, 'FunASR reconnect max attempts reached')
      return
    }

    this.reconnectAttempts++
    const delay = this.options.reconnectDelay || 3000
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect().then(() => {
        this.reconnectAttempts = 0
      }).catch((err) => {
        logger.error({ err, attempt: this.reconnectAttempts }, 'FunASR reconnect failed')
        this.scheduleReconnect()
      })
    }, delay)
  }
}
