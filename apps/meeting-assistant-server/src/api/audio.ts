/**
 * 音频上传 WS —— FunASR 官方协议纯转发
 *
 * 浏览器 → 后端:
 *   - 第一帧:JSON 配置
 *   - 后续帧:PCM Int16 二进制
 *   - 停止帧:JSON {is_speaking: false}
 *
 * 后端 → FunASR:原样转发
 */
import type { WebSocket } from 'ws'
import { logger } from '../logger.js'
import type { FunasrClient } from '../asr-relay/funasr-client.js'
import type { ChunkDistributor } from '../asr-relay/chunk-distributor.js'
import type { JudgmentEngine } from '../judgment/judgment-engine.js'

export class AudioWs {
  constructor(
    private funasr: FunasrClient,
    private distributor: ChunkDistributor,
    private engine: JudgmentEngine,
  ) {
    // FunASR 识别结果 → 判断引擎
    this.funasr.on((result) => {
      const chunk = this.distributor.distribute(result.text, result.mode, result.timestamp)
      this.engine.onAsrChunk(chunk).catch((err) => {
        logger.error({ err }, 'Engine processing failed')
      })
    })
  }

  /** 处理浏览器音频上传 —— 纯转发,不做转码 */
  handle(ws: WebSocket): void {
    logger.info('Browser audio connection')

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      try {
        if (isBinary) {
          // PCM 二进制帧:直接转发给 FunASR
          if (this.funasr.isConnected()) {
            this.funasr.sendPcm(data)
          }
        } else {
          // JSON 控制帧(配置 / 结束)
          const msg = JSON.parse(data.toString())
          logger.debug({ msg }, 'audio control frame')

          if (msg.is_speaking === false) {
            // 结束帧
            this.funasr.sendEndFrame()
          } else if (msg.mode) {
            // 配置帧
            this.funasr.sendConfig(msg)
          }
        }
      } catch (err) {
        logger.error({ err }, 'Audio message processing failed')
      }
    })

    ws.on('close', () => {
      logger.info('Browser audio disconnected')
    })

    ws.on('error', (err) => {
      logger.warn({ err }, 'Browser audio error')
    })
  }
}
