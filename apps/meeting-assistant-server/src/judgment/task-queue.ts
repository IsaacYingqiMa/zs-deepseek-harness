/**
 * 任务队列 - Task 的存储与查找
 *
 * 职责:
 *   1. 存储所有 Task
 *   2. 按状态筛选
 *   3. 去重(相似需求合并)
 *   4. 相似度计算
 *   5. 输出 TaskSummary(给前端用)
 */
import { nanoid } from 'nanoid'
import { logger } from '../logger.js'
import { isTerminalState } from './state-machine.js'
import type {
  Task, TaskSummary, TaskStatus, AsrChunk, TaskIntent,
  Feasibility, CompletionItem, TranscriptSegment,
} from '../types/task.js'

/** jaccard 相似度阈值(40% 重合算重复) */
const SIMILARITY_THRESHOLD = 0.4

export class TaskQueue {
  private tasks: Map<string, Task> = new Map()
  private transcriptSegments: Map<string, TranscriptSegment> = new Map()

  /** 创建或合并 Task */
  upsert(
    chunk: AsrChunk,
    interpreted: string,
    intent: TaskIntent,
    keywords: string[],
  ): { task: Task; isNew: boolean } {
    // 1. 查找相似 Task
    const existing = this.findSimilar(interpreted, keywords)

    if (existing) {
      this.appendToTask(existing, chunk, interpreted, keywords)
      return { task: existing, isNew: false }
    }

    // 2. 创建新 Task
    const task = this.createTask(chunk, interpreted, intent, keywords)
    this.tasks.set(task.id, task)
    return { task, isNew: true }
  }

  /** 获取 task */
  get(id: string): Task | undefined {
    return this.tasks.get(id)
  }

  /**
   * 用 LLM 输出创建 Task(完全不合并,每个意图独立)
   *
   * - 严格校验 target
   * - 处理 relationTo 4 种关系
   * - 记录 currentChunkId 用于前端按轮分组
   */
  createFromLlm(
    chunk: AsrChunk,
    llmIntent: {
      intent: TaskIntent | 'approval' | 'rejection' | 'defer' | 'unclear'
      rawText: string
      interpreted: string
      target: string | null
      confidence: number
      relationTo: { taskId: string | null; type: 'supersedes' | 'extends' | 'conflicts' | 'rejects' | 'approval' | null } | null
      reasoning: string
    },
  ): { task: Task; isNew: boolean; handledAsReject?: boolean } | null {
    // 0. 特殊意图:approval / rejection / defer — 不创建新 task,只更新上文
    if (llmIntent.intent === 'approval') {
      return this.handleApproval(chunk, llmIntent)
    }
    if (llmIntent.intent === 'rejection') {
      return this.handleRejection(chunk, llmIntent)
    }
    if (llmIntent.intent === 'defer') {
      return this.handleDefer(chunk, llmIntent)
    }
    if (llmIntent.intent === 'unclear' || llmIntent.intent === 'discussion') {
      logger.info({ rawText: llmIntent.rawText }, 'unclear intent, skip')
      return null
    }

    // 1. 校验 target 必须有(意图类必须有目标)
    if (!llmIntent.target || llmIntent.target.trim() === '') {
      logger.info({ rawText: llmIntent.rawText }, 'task rejected: target missing')
      return null
    }
    // 2. 校验 intent 必须有效
    const validIntents: TaskIntent[] = ['add-feature', 'modify-feature', 'delete-feature', 'fix-bug', 'data-change']
    if (!validIntents.includes(llmIntent.intent as TaskIntent)) {
      logger.info({ intent: llmIntent.intent }, 'task rejected: invalid intent')
      return null
    }

    // 3. 精确去重:interpreted 文本完全一致 → 合并到现有 task
    const normalizedInterpreted = llmIntent.interpreted.trim()
    for (const existing of this.tasks.values()) {
      if (existing.requirement.interpreted.trim() === normalizedInterpreted) {
        // 找到重复 task:更新 mentionCount 和 lastSeenAt,不创建新 task
        existing.source.mentionCount++
        existing.source.lastSeenAt = chunk.timestamp
        if (!existing.source.speakers.includes(chunk.speaker)) {
          existing.source.speakers.push(chunk.speaker)
        }
        existing.source.asrChunkIds.push(chunk.id)
        logger.info({
          existingId: existing.id,
          interpreted: normalizedInterpreted.substring(0, 40),
          mentionCount: existing.source.mentionCount,
        }, 'task deduplicated (interpreted exact match)')
        return { task: existing, isNew: false }
      }
    }

    // 3.5 语义去重:同 intent + 同 target 对象(如 "header颜色" vs "头部颜色") → 合并
    const similar = this.findSemanticallySimilar(llmIntent.intent as string, llmIntent.target)
    if (similar && llmIntent.relationTo?.type !== 'supersedes') {
      similar.source.mentionCount++
      similar.source.lastSeenAt = chunk.timestamp
      similar.source.asrChunkIds.push(chunk.id)
      similar.timeline.push({
        at: Date.now(),
        status: similar.status,
        reason: `同一对象的再次提及:${llmIntent.reasoning}`,
      })
      logger.info({
        existingId: similar.id,
        intent: llmIntent.intent,
        target: llmIntent.target,
        mentionCount: similar.source.mentionCount,
      }, 'task deduplicated (semantic target match)')
      return { task: similar, isNew: false }
    }

    // 4. 创建新 Task(不查重,不合并)
    const task = this.createTask(chunk, llmIntent.interpreted, llmIntent.intent as TaskIntent, [])
    task.source.currentChunkId = chunk.id
    task.llm = {
      target: llmIntent.target,
      confidence: llmIntent.confidence,
      reasoning: llmIntent.reasoning,
    }

    // 5. 处理 relationTo
    const rel = llmIntent.relationTo
    if (rel?.taskId && rel.type) {
      const related = this.tasks.get(rel.taskId)
      if (related) {
        const now = Date.now()
        switch (rel.type) {
          case 'supersedes':
            related.relations = { ...related.relations, supersededBy: task.id }
            related.status = 'superseded'
            related.timeline.push({
              at: now,
              status: 'superseded',
              reason: `被新需求 #${task.id.slice(0, 6)} 取代:${llmIntent.reasoning}`,
            })
            this.tasks.set(related.id, related)
            logger.info({ oldTask: related.id, newTask: task.id }, 'task superseded')
            break
          case 'extends':
            task.relations = { ...task.relations, extends: related.id }
            related.timeline.push({
              at: now,
              status: related.status,
              reason: `被新需求 #${task.id.slice(0, 6)} 扩展:${llmIntent.reasoning}`,
            })
            this.tasks.set(related.id, related)
            logger.info({ extended: related.id, by: task.id }, 'task extends')
            break
          case 'rejects':
            // 驳回:旧 task 改 rejected,新 task 不创建
            related.status = 'rejected'
            related.timeline.push({
              at: now,
              status: 'rejected',
              reason: `被新需求驳回:${llmIntent.reasoning}`,
            })
            this.tasks.set(related.id, related)
            logger.info({ rejected: related.id }, 'task rejected by new statement')
            return { task: related, isNew: false, handledAsReject: true }
          case 'conflicts':
            task.relations = { ...task.relations, conflicts: [...(task.relations?.conflicts || []), related.id] }
            related.relations = { ...related.relations, conflicts: [...(related.relations?.conflicts || []), task.id] }
            this.tasks.set(related.id, related)
            logger.warn({ newTask: task.id, conflictsWith: related.id }, 'task conflicts')
            break
        }
      }
    }

    this.tasks.set(task.id, task)
    logger.info({
      taskId: task.id,
      intent: task.requirement.intent,
      target: task.llm?.target,
      confidence: task.llm?.confidence,
    }, 'task created from LLM')

    return { task, isNew: true }
  }

  /** 获取最近 N 个活跃 task(给 LLM 关系判断用) */
  getRecentActive(n = 5): Array<{
    id: string
    interpreted: string
    intent: string
    status: string
  }> {
    const active = Array.from(this.tasks.values())
      .filter(t => !['rejected', 'superseded', 'failed'].includes(t.status))
      .sort((a, b) => b.source.lastSeenAt - a.source.lastSeenAt)
      .slice(0, n)
    return active.map(t => ({
      id: t.id,
      interpreted: t.requirement.interpreted,
      intent: t.requirement.intent,
      status: t.status,
    }))
  }

  /** 获取【全部】task(含 terminal,给 LLM 去重判断用;最新在前) */
  getAllTasksForLlm(): Array<{
    id: string
    interpreted: string
    intent: string
    status: string
    target: string | null
  }> {
    return Array.from(this.tasks.values())
      .sort((a, b) => b.source.lastSeenAt - a.source.lastSeenAt)
      .map(t => ({
        id: t.id,
        interpreted: t.requirement.interpreted,
        intent: t.requirement.intent,
        status: t.status,
        target: t.llm?.target ?? null,
      }))
  }

  /**
   * 语义近似去重:按 target + intent 匹配已有 task
   *
   * 规则(比字符串全等宽松,但比 jaccard 严格):
   *   - intent 相同,且 target 字符串互相包含(如 "header 头部颜色" vs "头部(header)颜色")
   *   → 视为同一需求,合并 mentionCount,不建新 task
   */
  findSemanticallySimilar(intent: string, target: string | null): Task | undefined {
    if (!target) return undefined
    const normTarget = target.trim()
    if (!normTarget) return undefined

    for (const task of this.tasks.values()) {
      if (task.status === 'rejected' || task.status === 'superseded') continue
      if (task.requirement.intent !== intent) continue

      const existingTarget = (task.llm?.target ?? '').trim()
      if (!existingTarget) continue

      // 互相包含或高重合 → 同一对象
      const contains =
        existingTarget.includes(normTarget) ||
        normTarget.includes(existingTarget) ||
        this.charOverlap(existingTarget, normTarget) >= 0.5
      if (contains) {
        return task
      }
    }
    return undefined
  }

  /** 中文场景的字符重合率(双向,2-gram 集合交集/较小集合) */
  private charOverlap(a: string, b: string): number {
    const grams = (s: string) => {
      const set = new Set<string>()
      for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
      return set
    }
    const ga = grams(a)
    const gb = grams(b)
    if (ga.size === 0 || gb.size === 0) return 0
    let inter = 0
    for (const g of ga) if (gb.has(g)) inter++
    return inter / Math.min(ga.size, gb.size)
  }

  /** 更新 task */
  update(id: string, changes: Partial<Task>): Task | undefined {
    const task = this.tasks.get(id)
    if (!task) return undefined
    Object.assign(task, changes)
    return task
  }

  /** 修改 task 状态 */
  setStatus(id: string, status: TaskStatus, reason: string, evidence?: string): Task | undefined {
    const task = this.tasks.get(id)
    if (!task) return undefined
    task.status = status
    task.timeline.push({ at: Date.now(), status, reason, evidence })
    return task
  }

  /** 设置可行性 */
  setFeasibility(id: string, feasibility: Feasibility): Task | undefined {
    const task = this.tasks.get(id)
    if (!task) return undefined
    task.feasibility = feasibility
    return task
  }

  /** 添加自主补全 */
  addCompletions(id: string, completions: CompletionItem[]): Task | undefined {
    const task = this.tasks.get(id)
    if (!task) return undefined
    task.completions.autoFilled.push(...completions)
    return task
  }

  /** 设置执行信息 */
  setExecution(
    id: string,
    exec: Partial<Task['execution']>,
  ): Task | undefined {
    const task = this.tasks.get(id)
    if (!task) return undefined
    task.execution = { ...task.execution, ...exec }
    return task
  }

  /**
   * 处理 approval 类意图:不创建新 task,只更新上文 task 的 mentionCount
   */
  private handleApproval(
    chunk: AsrChunk,
    llmIntent: {
      intent: string
      rawText: string
      interpreted: string
      target: string | null
      confidence: number
      relationTo: { taskId: string | null; type: string | null } | null
      reasoning: string
    },
  ): { task: Task; isNew: boolean; handledAsReject?: boolean } | null {
    const rel = llmIntent.relationTo
    const targetTaskId = rel?.taskId

    if (!targetTaskId) {
      logger.info({ rawText: llmIntent.rawText }, 'approval but no related task, skip')
      return null
    }

    const related = this.tasks.get(targetTaskId)
    if (!related) {
      logger.info({ taskId: targetTaskId }, 'approval target task not found')
      return null
    }

    // 增加 mentionCount,更新时间戳,记录 timeline
    related.source.mentionCount++
    related.source.lastSeenAt = chunk.timestamp
    related.source.asrChunkIds.push(chunk.id)
    related.timeline.push({
      at: Date.now(),
      status: related.status,
      reason: `确认执行:${llmIntent.reasoning}`,
    })

    logger.info({
      taskId: related.id,
      interpreted: related.requirement.interpreted.substring(0, 40),
      mentionCount: related.source.mentionCount,
    }, 'task approval received (merged, no new task)')

    return { task: related, isNew: false }
  }

  /**
   * 处理 rejection 类意图:不创建新 task,把上文 task 标记为 rejected
   */
  private handleRejection(
    chunk: AsrChunk,
    llmIntent: {
      intent: string
      rawText: string
      interpreted: string
      target: string | null
      confidence: number
      relationTo: { taskId: string | null; type: string | null } | null
      reasoning: string
    },
  ): { task: Task; isNew: boolean; handledAsReject?: boolean } | null {
    const rel = llmIntent.relationTo
    const targetTaskId = rel?.taskId

    if (!targetTaskId) return null
    const related = this.tasks.get(targetTaskId)
    if (!related) return null

    related.status = 'rejected'
    related.timeline.push({
      at: Date.now(),
      status: 'rejected',
      reason: `被驳回:${llmIntent.reasoning}`,
    })

    logger.info({ taskId: related.id, reason: llmIntent.reasoning }, 'task rejected by user')
    return { task: related, isNew: false, handledAsReject: true }
  }

  /**
   * 处理 defer 类意图:不创建新 task,把上文 task 标记为 deferred
   */
  private handleDefer(
    chunk: AsrChunk,
    llmIntent: {
      intent: string
      rawText: string
      interpreted: string
      target: string | null
      confidence: number
      relationTo: { taskId: string | null; type: string | null } | null
      reasoning: string
    },
  ): { task: Task; isNew: boolean; handledAsReject?: boolean } | null {
    const rel = llmIntent.relationTo
    const targetTaskId = rel?.taskId

    if (!targetTaskId) return null
    const related = this.tasks.get(targetTaskId)
    if (!related) return null

    related.status = 'deferred'
    related.timeline.push({
      at: Date.now(),
      status: 'deferred',
      reason: `用户暂存:${llmIntent.reasoning}`,
    })

    logger.info({ taskId: related.id }, 'task deferred by user')
    return { task: related, isNew: false }
  }

  /** 获取所有 task(转成 Summary) */
  getAllSummaries(): TaskSummary[] {
    return Array.from(this.tasks.values()).map(this.toSummary)
  }

  /** 获取活跃 task */
  getActiveTasks(): Task[] {
    return Array.from(this.tasks.values()).filter(t => !isTerminalState(t.status))
  }

  /** 获取待执行的 task(confirmed 状态) */
  getReadyToExecute(): Task[] {
    return Array.from(this.tasks.values()).filter(t => t.status === 'confirmed')
  }

  /** 获取摘要 */
  getSummary(id: string): TaskSummary | undefined {
    const task = this.tasks.get(id)
    return task ? this.toSummary(task) : undefined
  }

  /** 获取转写片段 */
  getTranscriptSegment(chunkId: string): TranscriptSegment | undefined {
    return this.transcriptSegments.get(chunkId)
  }

  /** 获取所有转写片段 */
  getAllTranscriptSegments(): TranscriptSegment[] {
    return Array.from(this.transcriptSegments.values()).sort((a, b) => a.at - b.at)
  }

  /** 清空 */
  clear(): void {
    this.tasks.clear()
    this.transcriptSegments.clear()
  }

  // ===== 私有 =====

  private createTask(
    chunk: AsrChunk,
    interpreted: string,
    intent: TaskIntent,
    keywords: string[],
  ): Task {
    const segment: TranscriptSegment = {
      chunkId: chunk.id,
      speaker: chunk.speaker,
      text: chunk.text,
      at: chunk.timestamp,
    }
    this.transcriptSegments.set(chunk.id, segment)

    return {
      id: nanoid(8),
      status: 'detected',
      source: {
        asrChunkIds: [chunk.id],
        speakers: [chunk.speaker],
        firstSeenAt: chunk.timestamp,
        lastSeenAt: chunk.timestamp,
        mentionCount: 1,
        transcript: [segment],
      },
      requirement: {
        raw: chunk.text,
        interpreted,
        intent,
        keywords,
      },
      feasibility: {
        technical: 'unknown',
        workload: 'small',
        riskLevel: 'low',
        inWhitelist: false,
        codeMapRefs: [],
        reasoning: '',
      },
      completions: {
        autoFilled: [],
        userOverrides: [],
      },
      execution: {},
      timeline: [{
        at: Date.now(),
        status: 'detected',
        reason: '从 ASR 识别',
        evidence: chunk.text,
      }],
    }
  }

  private appendToTask(
    task: Task,
    chunk: AsrChunk,
    interpreted: string,
    keywords: string[],
  ): void {
    const segment: TranscriptSegment = {
      chunkId: chunk.id,
      speaker: chunk.speaker,
      text: chunk.text,
      at: chunk.timestamp,
    }
    this.transcriptSegments.set(chunk.id, segment)

    task.source.asrChunkIds.push(chunk.id)
    if (!task.source.speakers.includes(chunk.speaker)) {
      task.source.speakers.push(chunk.speaker)
    }
    task.source.lastSeenAt = chunk.timestamp
    task.source.mentionCount++
    task.source.transcript.push(segment)

    // 合并关键词
    for (const kw of keywords) {
      if (!task.requirement.keywords.includes(kw)) {
        task.requirement.keywords.push(kw)
      }
    }

    // 更新解读(以最新一次为主)
    task.requirement.interpreted = interpreted
    task.requirement.raw = chunk.text

    task.timeline.push({
      at: Date.now(),
      status: task.status,
      reason: `再次提及(共 ${task.source.mentionCount} 次)`,
      evidence: chunk.text,
    })
  }

  private findSimilar(interpreted: string, keywords: string[]): Task | undefined {
    const targetKeywords = new Set(keywords)
    if (targetKeywords.size === 0) return undefined

    for (const task of this.tasks.values()) {
      // 已结束的任务不合并
      if (isTerminalState(task.status)) continue

      const taskKeywords = new Set(task.requirement.keywords)
      const overlap = this.jaccard(targetKeywords, taskKeywords)
      if (overlap >= SIMILARITY_THRESHOLD) {
        logger.debug({
          taskId: task.id,
          overlap,
          interpreted,
        }, '找到相似 task,合并')
        return task
      }
    }
    return undefined
  }

  private jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0
    const intersection = new Set([...a].filter(x => b.has(x)))
    const union = new Set([...a, ...b])
    return intersection.size / union.size
  }

  private toSummary(task: Task): TaskSummary {
    return {
      id: task.id,
      status: task.status,
      interpreted: task.requirement.interpreted,
      intent: task.requirement.intent,
      mentionCount: task.source.mentionCount,
      speakers: task.source.speakers,
      feasibility: task.feasibility,
      completedAt: task.execution.finishedAt,
      modifiedFiles: task.execution.modifiedFiles,
      rejectionReason: task.timeline.find(t => t.status === 'rejected')?.reason,
      llm: task.llm,
      relations: task.relations,
      currentChunkId: task.source.currentChunkId,
    }
  }
}
