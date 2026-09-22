/**
 * Task 状态机(xstate)
 *
 * 状态流转:
 *   detected → analyzing → confirmed → executing → completed
 *                  ↓            ↓
 *               rejected     deferred
 *                                  ↓
 *                              confirmed
 *
 * 关键事件:
 *   - ANALYZE: 开始可行性分析
 *   - FEASIBLE / INFEASIBLE: 分析结果
 *   - CONFIRM: 确认执行
 *   - DEFER / REJECT: 暂存 / 拒绝
 *   - EXECUTE / COMPLETE / FAIL: 执行阶段
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

export const taskMachine = createMachine({
  id: 'task',
  initial: 'detected',
  states: {
    detected: {
      on: {
        ANALYZE: 'analyzing',
        REJECT: 'rejected',
      },
    },
    analyzing: {
      on: {
        FEASIBLE: 'confirmed',
        INFEASIBLE: 'rejected',
        DEFER: 'deferred',
        REJECT: 'rejected',
      },
    },
    confirmed: {
      on: {
        EXECUTE: 'executing',
        DEFER: 'deferred',
        REJECT: 'rejected',
      },
    },
    executing: {
      on: {
        COMPLETE: 'completed',
        FAIL: 'failed',
        REJECT: 'rejected',
      },
    },
    completed: { type: 'final' },
    failed: {
      on: {
        RETRY: 'executing',
        REJECT: 'rejected',
      },
    },
    rejected: { type: 'final' },
    deferred: {
      on: {
        CONFIRM: 'analyzing',
        REJECT: 'rejected',
        EXECUTE: 'confirmed',
      },
    },
  },
})

/** 状态机是否处于"活跃可执行" */
export function isActiveState(state: TaskStatus): boolean {
  return ['detected', 'analyzing', 'confirmed', 'deferred'].includes(state)
}

/** 状态机是否处于"已完成" */
export function isTerminalState(state: TaskStatus): boolean {
  return ['completed', 'rejected', 'failed'].includes(state)
}

/** 状态机的下一步判断 */
export function nextAction(_state: TaskStatus, _event: AnyEventObject): TaskState | null {
  // 简化版:基于当前状态返回下一步
  // 实际用 xstate 的 actor.transition()
  return null
}
