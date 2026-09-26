/**
 * VersionTracker —— 每次文件修改的全局版本号 + 修改历史
 *
 * 用法:
 *   const tracker = new VersionTracker()
 *   const v = tracker.bump(['src/index.ts'])  // 返回新版本号
 *
 *   // 监听
 *   tracker.subscribe(v => console.log(`v${v.version} 修改了`, v.files))
 */
import { logger } from '../logger.js'

export interface VersionBump {
  /** 新版本号(自增,从 1 开始) */
  version: number
  /** 这次改动的文件列表 */
  files: string[]
  /** 触发的 task id(可能 undefined,某些改动没 task) */
  taskId?: string
  /** 触发时间戳 */
  timestamp: number
}

export type VersionBumpListener = (bump: VersionBump) => void

export class VersionTracker {
  private currentVersion = 1
  private history: VersionBump[] = []
  private listeners: Set<VersionBumpListener> = new Set()

  /** 触发一次版本 +1(每次代码改动都调) */
  bump(files: string[], taskId?: string): VersionBump {
    this.currentVersion++
    const bump: VersionBump = {
      version: this.currentVersion,
      files: [...files],
      taskId,
      timestamp: Date.now(),
    }
    this.history.push(bump)
    // 保留最近 50 条
    if (this.history.length > 50) {
      this.history = this.history.slice(-50)
    }
    logger.info({
      version: bump.version,
      fileCount: files.length,
      taskId,
    }, 'version bump')
    // 通知所有订阅者
    for (const l of this.listeners) {
      try { l(bump) } catch (err) { logger.warn({ err }, 'version listener error') }
    }
    return bump
  }

  /** 当前版本号 */
  getCurrent(): number {
    return this.currentVersion
  }

  /** 修改历史(最近 N 条) */
  getHistory(limit = 20): VersionBump[] {
    return this.history.slice(-limit)
  }

  /** 订阅版本变化(可多次) */
  subscribe(listener: VersionBumpListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 重置(开始新会议时) */
  reset(): void {
    this.currentVersion = 0
    this.history = []
    // 不清 listeners(让 listeners 自己 unsubscribe)
  }
}

/** 全局单例(让 dsh-runner 和 judgment-engine 共享) */
export const globalVersionTracker = new VersionTracker()
