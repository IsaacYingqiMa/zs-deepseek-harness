/**
 * Task 状态机(xstate)
 *
 * 状态流转:
 *   detected → analyzing → confirmed → executing → completed
 *                  ↓            ↓              ↓
 *               rejected     deferred      superseded
 *                                  ↓
 *                              confirmed
 *
 * 关键事件:
 *   - ANALYZE: 开始可行性分析
 *   - FEASIBLE / INFEASIBLE: 分析结果
 *   - CONFIRM: 确认执行
 *   - DEFER / REJECT: 暂存 / 拒绝
 *   - EXECUTE / COMPLETE / FAIL: 执行阶段
 *   - SUPERSEDE: 被新需求取代(task-queue.ts 直接赋值,不走事件;
 *     这里加事件定义仅为状态机完整性)
 */
import { createMachine, type AnyEventObject } from 'xstate'
import type { TaskStatus } from '../types/task.js'

export type TaskState =
  | 'detected'
  | 'analyzing'
  | 'confirmed'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'deferred'
  | 'superseded'

export type TaskEvent =
  | { type: 'ANALYZE' }
  | { type: 'FEASIBLE' }
  | { type: 'INFEASIBLE' }
  | { type: 'CONFIRM' }
  | { type: 'DEFER'; reason?: string }
  | { type: 'REJECT'; reason: string }
  | { type: 'EXECUTE' }
  | { type: 'COMPLETE'; files: string[] }
  | { type: 'FAIL'; error: string }
  | { type: 'RETRY' }
  | { type: 'SUPERSEDE'; newTaskId: string }

export const taskMachine = createMachine({
  id: 'task',
  initial: 'detected',
  states: {
    detected: {
      on: {
        ANALYZE: 'analyzing',
        REJECT: 'rejected',
        SUPERSEDE: 'superseded',
      },
    },
    analyzing: {
      on: {
        FEASIBLE: 'confirmed',
        INFEASIBLE: 'rejected',
        DEFER: 'deferred',
        REJECT: 'rejected',
        SUPERSEDE: 'superseded',
      },
    },
    confirmed: {
      on: {
        EXECUTE: 'executing',
        DEFER: 'deferred',
        REJECT: 'rejected',
        SUPERSEDE: 'superseded',
      },
    },
    executing: {
      on: {
        COMPLETE: 'completed',
        FAIL: 'failed',
        REJECT: 'rejected',
        SUPERSEDE: 'superseded',
      },
    },
    completed: { type: 'final' },
    failed: {
      on: {
        RETRY: 'executing',
        REJECT: 'rejected',
        SUPERSEDE: 'superseded',
      },
    },
    rejected: { type: 'final' },
    deferred: {
      on: {
        CONFIRM: 'analyzing',
        REJECT: 'rejected',
        EXECUTE: 'confirmed',
        SUPERSEDE: 'superseded',
      },
    },
    // ★ 新增:superseded 状态(被新需求取代)
    // 终态,不再调度,前端展示灰色
    superseded: { type: 'final' },
  },
})

/** 状态机是否处于"活跃可执行" */
export function isActiveState(state: TaskStatus): boolean {
  return ['detected', 'analyzing', 'confirmed', 'deferred'].includes(state)
}

/** 状态机是否处于"已完成"(含 superseded — 不再调度) */
export function isTerminalState(state: TaskStatus): boolean {
  return ['completed', 'rejected', 'failed', 'superseded'].includes(state)
}

/** 状态机的下一步判断 */
export function nextAction(_state: TaskStatus, _event: AnyEventObject): TaskState | null {
  // 简化版:基于当前状态返回下一步
  // 实际用 xstate 的 actor.transition()
  return null
}
