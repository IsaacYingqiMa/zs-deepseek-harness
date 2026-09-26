/**
 * 手动输入 WebSocket
 *
 * 物理隔离录音流,文本输入走 ChunkDistributor → JudgmentEngine 的同一路径。
 * 用于:不依赖麦克风/ASR,直接打字测试规划能力。
 */
/* eslint-disable typescript/no-unsafe-assignment,
   typescript/no-unsafe-member-access,
   typescript/no-unsafe-argument,
   typescript/no-unnecessary-type-assertion,
   typescript/use-unknown-in-catch-callback-variable */
import type { WebSocket } from 'ws'
import { logger } from '../logger.js'
import type { ChunkDistributor } from '../asr-relay/chunk-distributor.js'
import type { JudgmentEngine } from '../judgment/judgment-engine.js'

export class ManualInputWs {
  constructor(
    private distributor: ChunkDistributor,
    private engine: JudgmentEngine,
  ) {}

  handle(ws: WebSocket): void {
    logger.info('Manual input WS connected')

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString())

        if (msg.type === 'input') {
          this.handleInput(ws, msg)
        } else if (msg.type === 'set-speaker') {
          this.handleSetSpeaker(msg)
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }))
        }
      } catch (err) {
        logger.warn({ err, data: data.toString() }, 'Invalid manual input message')
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }))
      }
    })

    ws.on('close', () => {
      logger.info('Manual input WS disconnected')
    })

    ws.on('error', (err) => {
      logger.warn({ err }, 'Manual input WS error')
    })

    // 初始欢迎
    ws.send(JSON.stringify({
      type: 'connected',
      message: '已连接到手动输入通道。发送 {type:"input", text:"...", speaker:"boss|pm|dev"}',
    }))
  }

  private handleInput(ws: WebSocket, msg: { text?: unknown; speaker?: unknown }): void {
    const { text, speaker = 'unknown' } = msg

    if (!text || typeof text !== 'string') {
      ws.send(JSON.stringify({ type: 'error', message: 'text required' }))
      return
    }

    if (speaker !== 'boss' && speaker !== 'pm' && speaker !== 'dev' && speaker !== 'unknown') {
      ws.send(JSON.stringify({ type: 'error', message: 'invalid speaker' }))
      return
    }

    logger.info({ text: text.substring(0, 50), speaker }, 'Manual input received')

    // 走 ChunkDistributor.distribute(强制指定 speaker),内部会 emit 'chunk' 事件
    // 同时返回 chunk 对象,我们再交给 engine 处理
    const chunk = this.distributor.distribute(
      text,
      'offline',
      Date.now(),
      speaker as 'boss' | 'pm' | 'dev' | 'unknown',
    )

    // 推送给判断引擎
    this.engine.onAsrChunk(chunk).catch((err) => {
      logger.error({ err }, 'Engine processing failed (manual input)')
    })

    // 回执
    ws.send(JSON.stringify({
      type: 'received',
      chunkId: chunk.id,
      speaker: chunk.speaker,
      textLength: text.length,
    }))
  }

  private handleSetSpeaker(msg: { speaker?: unknown }): void {
    const { speaker } = msg
    if (speaker !== 'boss' && speaker !== 'pm' && speaker !== 'dev') {
      return
    }
    this.distributor.registerSpeaker(speaker as 'boss' | 'pm' | 'dev')
    logger.info({ speaker }, 'Speaker registered via manual input')
  }
}
