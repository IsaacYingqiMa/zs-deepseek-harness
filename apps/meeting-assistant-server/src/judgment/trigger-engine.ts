/**
 * 触发引擎 - 决定什么时候该执行
 *
 * 关键判断(规则化,稳定可控):
 *   1. 只要有人提出 + 没被驳回 + LLM 评估可行 → 立即执行
 *   2. 但要满足白名单 + 风险约束
 */
import type { Task } from '../types/task.js'

export interface TriggerDecision {
  shouldExecute: boolean
  shouldDefer: boolean
  shouldReject: boolean
  reason: string
}

export class TriggerEngine {
  /**
   * 评估一个 task 是否应该执行
   */
  evaluate(task: Task): TriggerDecision {
    // 1. 必须确认状态
    if (task.status !== 'confirmed') {
      return {
        shouldExecute: false,
        shouldDefer: false,
        shouldReject: false,
        reason: `状态为 ${task.status},不能执行`,
      }
    }

    // 2. 可行性必须通过
    if (task.feasibility.technical !== 'feasible') {
      return {
        shouldExecute: false,
        shouldDefer: false,
        shouldReject: task.feasibility.technical === 'infeasible',
        reason: `可行性未通过: ${task.feasibility.reasoning}`,
      }
    }

    // 3. 必须在允许范围内
    if (!task.feasibility.inWhitelist) {
      return {
        shouldExecute: false,
        shouldDefer: false,
        shouldReject: true,
        reason: '超出允许范围(改架构/第三方依赖/权限相关)',
      }
    }

    // 4. 风险不能高
    if (task.feasibility.riskLevel === 'high') {
      return {
        shouldExecute: false,
        shouldDefer: true,
        shouldReject: false,
        reason: '风险等级高,暂存待人工 review',
      }
    }

    // 5. 工作量不能太大(>5 分钟)
    if (task.feasibility.workload === 'large') {
      return {
        shouldExecute: false,
        shouldDefer: true,
        shouldReject: false,
        reason: '工作量较大,建议拆分或暂存',
      }
    }

    // 6. 必须有提及来源(不是凭空冒出来的)
    if (task.source.mentionCount === 0) {
      return {
        shouldExecute: false,
        shouldDefer: true,
        shouldReject: false,
        reason: '无明确提及来源,等待上下文',
      }
    }

    // 所有条件通过 → 执行
    return {
      shouldExecute: true,
      shouldDefer: false,
      shouldReject: false,
      reason: '所有条件满足,准备执行',
    }
  }

  /**
   * 检测老板的"驳回"信号
   */
  detectRejection(text: string): { isRejection: boolean; confidence: number } {
    const patterns = [
      /(先不做|先不用|先不要|算了|取消)/,
      /(回头再说|下次再说|以后再说|下次讨论)/,
      /(先这样吧|先不改|先不动|不要改|不要动)/,
    ]

    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return { isRejection: true, confidence: 0.9 }
      }
    }
    return { isRejection: false, confidence: 0 }
  }

  /**
   * 检测老板的"确认执行"信号
   */
  detectConfirmation(text: string): { isConfirmed: boolean; confidence: number } {
    const patterns = [
      /(做吧|可以|好|行|就这么办)/,
      /(同意|确认|开始|改吧|动手吧)/,
      /(嗯|OK|ok|OK|可以)/,
    ]

    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return { isConfirmed: true, confidence: 0.85 }
      }
    }
    return { isConfirmed: false, confidence: 0 }
  }
}
