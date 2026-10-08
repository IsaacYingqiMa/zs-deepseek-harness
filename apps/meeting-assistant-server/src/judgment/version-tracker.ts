/**
 * VersionTracker —— 每次文件修改的全局版本号 + 修改历史
 *
 * 用法:
 *   const tracker = new VersionTracker()
 *   const v = tracker.bump(['src/index.ts'])  // 返回新版本号
 *
 *   // 监听
 *   tracker.subscribe(v => console.log(`v${v.version} 修改了`, v.files))
 *
 * 双层版本号:
 *   - globalVersionTracker:跨项目全局,所有修改共用一个数字(前端 AgentStatusRow 用)
 *   - per-project tracker:每个项目独立计数,版本号写到项目 data/version.json 里
 *     (项目页面自己 fetch 显示)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
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

/**
 * PerProjectVersionTracker —— 每个项目独立的版本号
 *
 * 设计目标:
 *   1. 每个项目有自己的版本计数(切到不同项目,版本号是各自的)
 *   2. bump 时同步写 data/version.json 到项目里(项目页面 fetch 显示)
 *   3. version.json 不算 files-changed(dsh 不会被自己写的版本文件误导)
 *
 * 用法:
 *   const tracker = getOrCreateProjectTracker(projectPath)
 *   tracker.bump(['js/data.js'], taskId)
 */
export class PerProjectVersionTracker {
  private currentVersion = 0
  private projectPath: string

  constructor(projectPath: string) {
    this.projectPath = projectPath
    // 启动时读已有 version.json(接续历史版本)
    this.loadFromDisk()
  }

  /** 触发一次项目版本 +1 */
  bump(files: string[], taskId?: string): VersionBump {
    this.currentVersion++
    const bump: VersionBump = {
      version: this.currentVersion,
      files: [...files],
      taskId,
      timestamp: Date.now(),
    }
    // 写入项目的 data/version.json(项目页面 fetch 显示)
    this.writeToDisk(bump)
    logger.info({
      project: this.projectPath,
      version: bump.version,
      fileCount: files.length,
      taskId,
    }, 'per-project version bump')
    return bump
  }

  getCurrent(): number {
    return this.currentVersion
  }

  /** 从磁盘读已有 version.json(支持跨重启续号) */
  private loadFromDisk(): void {
    const path = join(this.projectPath, 'data', 'version.json')
    if (!existsSync(path)) return
    try {
      const content = readFileSync(path, 'utf-8')
      const parsed = JSON.parse(content) as { version?: number }
      if (typeof parsed.version === 'number' && parsed.version > 0) {
        this.currentVersion = parsed.version
        logger.info({ project: this.projectPath, version: parsed.version }, 'loaded existing per-project version')
      }
    } catch (err) {
      logger.warn({ err, path }, 'failed to load per-project version.json')
    }
  }

  /** 写 version.json 到项目(原子写:先写 .tmp 再 rename) */
  private writeToDisk(bump: VersionBump): void {
    const dir = join(this.projectPath, 'data')
    const path = join(dir, 'version.json')
    try {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      const content = JSON.stringify(
        {
          version: bump.version,
          updatedAt: bump.timestamp,
          taskId: bump.taskId ?? null,
        },
        null,
        2,
      )
      writeFileSync(path, content, 'utf-8')
    } catch (err) {
      logger.warn({ err, path }, 'failed to write per-project version.json')
    }
  }
}

/** 项目 tracker 缓存(同一项目路径复用同一 tracker) */
const perProjectTrackers = new Map<string, PerProjectVersionTracker>()

export function getOrCreateProjectTracker(projectPath: string): PerProjectVersionTracker {
  let tracker = perProjectTrackers.get(projectPath)
  if (!tracker) {
    tracker = new PerProjectVersionTracker(projectPath)
    perProjectTrackers.set(projectPath, tracker)
  }
  return tracker
}

/** 清空缓存(切项目时不需要,但保留以便测试) */
export function clearProjectTrackers(): void {
  perProjectTrackers.clear()
}
