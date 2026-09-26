/**
 * 可行性评估器 —— LLM 主导 + 规则兜底
 *
 * 设计:
 *   - 默认调 LLM 综合判断(组合判定:feasible + inWhitelist + risk + workload)
 *   - LLM 调用失败 → 用纯规则 fallback(架构/路由/权限等关键词)
 *   - 项目类型(pure-html / framework)决定白/黑名单的严格程度
 *
 * 决策层只关心 LLM 判断结果,不关心 dsh 后续能否真的执行成功。
 */
import { logger } from '../logger.js'
import type { LlmHelper } from './llm-helper.js'
import type { AgentState, AgentStatusData, CodeMap, Feasibility, Task } from '../types/task.js'

/** 状态 emit 回调类型 */
export type AgentStatusEmitter = (data: AgentStatusData) => void

export type ProjectType = 'pure-html' | 'framework'

/** 不同项目类型下的关键词规则 fallback */
function ruleFallback(task: Task, projectType: ProjectType): Feasibility {
  const text = task.requirement.interpreted

  if (projectType === 'pure-html') {
    // 纯 HTML 项目:白名单更宽(允许改 HTML/CSS/JS,黑名单更窄)
    const exceedsScope = /(node|服务端|express|数据库|数据库|sql|prisma|部署)/.test(text)
    if (exceedsScope) {
      return {
        technical: 'feasible',
        workload: 'medium',
        riskLevel: 'high',
        inWhitelist: false,
        codeMapRefs: [],
        reasoning: '涉及服务端/数据库,超出纯 HTML 范围',
      }
    }
    const isLarge = /(整套|全部|整个|所有页面|整体)/.test(text)
    if (isLarge) {
      return {
        technical: 'feasible',
        workload: 'large',
        riskLevel: 'medium',
        inWhitelist: true,
        codeMapRefs: [],
        reasoning: '工作量较大,建议拆分',
      }
    }
    return {
      technical: 'feasible',
      workload: 'small',
      riskLevel: 'low',
      inWhitelist: true,
      codeMapRefs: [],
      reasoning: '纯 HTML 项目,改 .html/.css/.js 即可',
    }
  }

  // framework 项目的 fallback
  const exceedsScope = /(架构|路由|权限|登录|支付|数据库|后端|API|部署|第三方|依赖|prisma)/.test(text)
  if (exceedsScope) {
    return {
      technical: 'feasible',
      workload: 'medium',
      riskLevel: 'high',
      inWhitelist: false,
      codeMapRefs: [],
      reasoning: '涉及核心架构/权限/第三方,超出白名单',
    }
  }
  const isLarge = /(整套|全部|整个|所有页面|整体)/.test(text)
  if (isLarge) {
    return {
      technical: 'feasible',
      workload: 'large',
      riskLevel: 'medium',
      inWhitelist: true,
      codeMapRefs: [],
      reasoning: '工作量较大,建议拆分',
    }
  }
  return {
    technical: 'feasible',
    workload: 'small',
    riskLevel: 'low',
    inWhitelist: true,
    codeMapRefs: [],
    reasoning: '在允许范围内(前端原型 CRUD)',
  }
}

/**
 * 简单的关键词规则 fallback(LLM 调用失败时用)
 *
 * 评估维度:
 *   - 超出范围:架构/路由/权限/支付/数据库/第三方依赖/部署
 *   - 大工作量:整套/全部/整个/所有页面/整体
 *
 * (旧的纯 framework 版本已合并到上面的 ruleFallback(task, projectType))
 */
/**
 * LLM 评估失败 → 用规则兜底
 */
function combineWithRuleFallback(task: Task, projectType: ProjectType, llmResult: Feasibility | null): Feasibility {
  if (llmResult) return llmResult
  logger.warn({ taskId: task.id, projectType }, 'LLM feasibility failed, using rule fallback')
  return ruleFallback(task, projectType)
}

/**
 * 组合判定:LLM 输出多个字段,后端组合判定最终是否可行
 *
 * 决策层统计口径:
 *   feasible = (
 *     feasibility.technical === 'feasible' &&
 *     feasibility.inWhitelist === true &&
 *     feasibility.riskLevel !== 'high' &&
 *     feasibility.workload !== 'large'
 *   )
 *
 * 注意:feasibility 标记不可变 —— 即使 dsh 后续执行失败,
 *       这里判定的可行性结果不变(决策层只判断"该不该做")。
 */
export function isLlmFeasible(f: Feasibility): boolean {
  return (
    f.technical === 'feasible' &&
    f.inWhitelist &&
    f.riskLevel !== 'high' &&
    f.workload !== 'large'
  )
}

/** 可行性评估器 */
export class FeasibilityEvaluator {
  /** 状态 emit 回调(由 judgment-engine 注入) */
  private emitStatus: AgentStatusEmitter | null = null

  constructor(
    private llm: LlmHelper,
    private projectType: ProjectType = 'framework',
  ) {}

  /** 注入状态 emit 回调(judgment-engine 在构造后调用) */
  setStatusEmitter(emitter: AgentStatusEmitter): void {
    this.emitStatus = emitter
  }

  /** 切换项目类型(ProjectsApi 切换时调用) */
  setProjectType(projectType: ProjectType): void {
    this.projectType = projectType
    logger.info({ projectType }, 'FeasibilityEvaluator projectType changed')
  }

  /** 私有 emit 包装 */
  private emitAgentStatus(state: AgentState, message?: string, durationMs?: number): void {
    if (!this.emitStatus) return
    this.emitStatus({
      agent: 'feasibility',
      state,
      message,
      durationMs,
      timestamp: Date.now(),
    })
  }

  /**
   * 评估 task 可行性
   * - 优先调 LLM(prompt 按 projectType 分流)
   * - 失败 fallback 纯规则
   * - 返回 Feasibility(完整结构)
   */
  async evaluate(task: Task, codeMap: CodeMap | null): Promise<Feasibility> {
    const start = Date.now()
    this.emitAgentStatus('working', `评估 task ${task.id.slice(0, 6)}`)

    try {
      const llmResult = await this.llm.evaluateFeasibility(task, codeMap, this.projectType)
      const result = combineWithRuleFallback(task, this.projectType, llmResult)
      const usedFallback = !llmResult
      this.emitAgentStatus(
        usedFallback ? 'triggered' : 'success',
        usedFallback
          ? 'LLM 失败,走规则 fallback'
          : `LLM 评估 ${isLlmFeasible(result) ? '可行' : '不可行'}`,
        Date.now() - start,
      )
      return result
    } catch (err) {
      this.emitAgentStatus('failed', '评估异常', Date.now() - start)
      throw err
    }
  }
}
