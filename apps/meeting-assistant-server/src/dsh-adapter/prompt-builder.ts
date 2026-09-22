/**
 * Prompt 构建器
 *
 * 把 Task 转成 dsh 能理解的结构化指令。
 * 拆出来便于测试和重用。
 */
import type { Task } from '../types/task.js'

/**
 * 给 dsh 的执行指令
 *
 * 设计原则:
 *   - 简洁明确(don't confuse LLM)
 *   - 包含所有必要上下文
 *   - 明确列出约束
 *   - 给出验证步骤
 */
export function buildExecutionPrompt(task: Task): string {
  const sections: string[] = []

  // Header
  sections.push(`# 会议任务 ${task.id}\n`)

  // 核心需求
  sections.push('## 需求')
  sections.push(task.requirement.interpreted)
  sections.push('')

  // 原始 ASR(给 dsh 参考上下文)
  if (task.source.transcript.length > 0) {
    sections.push('## 会议讨论原文')
    for (const seg of task.source.transcript) {
      sections.push(`[${seg.speaker}] ${seg.text}`)
    }
    sections.push('')
  }

  // 自主补全
  if (task.completions.autoFilled.length > 0) {
    sections.push('## 已自主补全的细节')
    for (const c of task.completions.autoFilled) {
      sections.push(`- **${c.field}** = ${c.value}`)
      sections.push(`  - 理由: ${c.reason}`)
    }
    sections.push('')
  }

  // 代码位置
  if (task.feasibility.codeMapRefs.length > 0) {
    sections.push('## 涉及代码')
    for (const ref of task.feasibility.codeMapRefs) {
      sections.push(`- ${ref}`)
    }
    sections.push('')
  }

  // 约束
  sections.push('## 约束')
  sections.push('- 工作量必须 < 5 分钟')
  sections.push('- 只改前端原型(组件/页面/样式/CRUD)')
  sections.push('- 不允许改: 路由 / 权限 / 第三方依赖 / Prisma schema')
  sections.push('- 失败立即停止,不要盲目重试')
  sections.push('')

  // 验证步骤
  sections.push('## 验证步骤')
  sections.push('1. 读相关文件')
  sections.push('2. 修改文件(用 edit_file 工具精确替换)')
  sections.push('3. 跑 lint / type check')
  sections.push('4. 报告结果')
  sections.push('')

  // 输出格式
  sections.push('## 输出要求')
  sections.push('完成后回复:')
  sections.push('```')
  sections.push('✅ 完成')
  sections.push('改动的文件: [list]')
  sections.push('验证: lint ✓ / type check ✓')
  sections.push('```')

  return sections.join('\n')
}
