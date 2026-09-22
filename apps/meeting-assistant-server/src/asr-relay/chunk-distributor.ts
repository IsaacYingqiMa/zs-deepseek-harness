/**
 * ASR Chunk 分发器
 *
 * 职责:
 *   1. 接收 FunASR 识别结果
 *   2. 包装成 AsrChunk(加 speaker、id 等)
 *   3. 分发给多个订阅者(浏览器 + 独立判断层)
 *
 * speaker 推断:
 *   - 当前简化:用"音色预设"模式
 *   - 会议开始时每人注册一次音色特征
 *   - 后续按音色匹配
 */
import { EventEmitter } from 'events'
import { nanoid } from 'nanoid'
import { logger } from '../logger.js'
import type { AsrChunk, SpeakerId } from '../types/task.js'

export interface SpeakerProfile {
  speaker: SpeakerId
  /** 音色指纹(简化:用平均音高) */
  pitchProfile?: number
  /** 注册时间 */
  registeredAt: number
}

export class ChunkDistributor extends EventEmitter {
  private speakerProfiles: SpeakerProfile[] = []
  private lastSpeaker: SpeakerId = 'unknown'

  /** 注册说话人(会议开始时调用) */
  registerSpeaker(speaker: SpeakerId): void {
    if (this.speakerProfiles.find(p => p.speaker === speaker)) return
    this.speakerProfiles.push({
      speaker,
      registeredAt: Date.now(),
    })
    logger.info({ speaker }, 'Speaker registered')
  }

  /** 清空注册(开始新会议) */
  resetSpeakers(): void {
    this.speakerProfiles = []
    this.lastSpeaker = 'unknown'
  }

  /**
   * 分发一个 FunASR 结果(或手动输入)
   *
   * mode 可能是:
   *   - 'online'             流式中间结果
   *   - 'offline'            最终结果(单 pass 模式)
   *   - '2pass-online'       流式(2pass 模式的流式部分)
   *   - '2pass-offline'      最终(2pass 模式的最终部分)
   */
  distribute(
    text: string,
    mode: string,
    timestamp: number,
    forceSpeaker?: SpeakerId,
  ): AsrChunk {
    const speaker = forceSpeaker || this.inferSpeaker(text)

    // 任何含 "offline" 的 mode 都视为最终结果
    const isFinal = mode === 'offline' || mode === '2pass-offline' || mode.endsWith('-offline')

    const chunk: AsrChunk = {
      id: nanoid(8),
      text,
      speaker,
      timestamp,
      isFinal,
      mode: mode as AsrChunk['mode'],
    }

    this.lastSpeaker = speaker
    this.emit('chunk', chunk)

    return chunk
  }

  /** 推断说话人(简化版:基于音色预设) */
  private inferSpeaker(text: string): SpeakerId {
    // 简化方案:通过语气词/前缀判断(更可靠靠音色匹配)
    // 这里用启发式:
    // - "我觉得..." "我认为..." 可能是 boss
    // - "建议..." "可以..." 可能是 pm
    // - "实现..." "改一下..." 可能是 dev

    if (this.speakerProfiles.length === 0) {
      // 未注册,基于文本启发式
      return this.heuristicInfer(text)
    }

    // 简化:循环轮转 + 启发式修正
    const registered = this.speakerProfiles.map(p => p.speaker)
    const lastIdx = registered.indexOf(this.lastSpeaker)
    const nextIdx = (lastIdx + 1) % registered.length

    // 启发式修正(基于语气词)
    const guess = this.heuristicInfer(text)
    if (guess !== 'unknown' && registered.includes(guess)) {
      return guess
    }

    return registered[nextIdx] || 'unknown'
  }

  private heuristicInfer(text: string): SpeakerId {
    if (/^(老板|领导|老大)/.test(text)) return 'boss'
    if (/^(产品|PM|经理)/.test(text)) return 'pm'
    if (/^(开发|研发|技术|代码|工程师)/.test(text)) return 'dev'

    // 文本启发式
    if (/(我觉得|我认为|我希望|决定)/.test(text)) return 'boss'
    if (/(用户|体验|流程|场景|需求)/.test(text)) return 'pm'
    if (/(实现|代码|组件|接口|函数|bug)/.test(text)) return 'dev'

    return 'unknown'
  }
}
