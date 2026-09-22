---
name: zsspec-done
description: >
  用于开发完成后的验收、证据核验、TASK/REQ 状态同步与完成判定。
  当用户说"做完了""验一下""检查完成情况""确认完成""更新完成状态"时优先使用。
  不适用于需求讨论、spec 生成、开发中变更处理或开始实现；若验收中发现漏项、错误或边界变化，优先转 zsspec-change。
---

# ZSSpec Done - 完成验收

执行最终验收与完成判定：核对 TASK 与 CHK 全量状态、处理 `automation=manual` 检查项，并判断 REQ 文档中的功能需求状态是否可更新为 `已完成`。

## 检查项来源

**所有检查项对应 checklist 目录下的 CHK 文档**：

- 检查项文件路径：`specs/checklist/[模块]/CHK-[模块].md`
- 格式要求参照：`.claude/skills/zsspec-test-gen/SKILL.md`
- CHK 文档包含结构化测试用例与 `automation=static/auto/manual` 标记，状态统一使用 `待执行/通过/失败/阻塞/跳过/废弃`

验收时必须读取对应模块的 CHK 文档，核对其中定义的检查项状态。

## 职责边界

`zsspec-done` 只负责：
- 核对 TASK 状态与 CHK 文档中 `static/auto/manual` 三类检查项状态是否已全部收口
- 处理 `automation=manual` 的检查项，并核对其他验证阶段已产出的证据
- 判定 REQ 文档中的功能需求状态是否可更新为 `已完成`
- 当所有前置条件满足时，更新 REQ 功能需求状态为 `已完成`
- 当任一前置条件不满足时，拒绝更新 REQ 状态，并明确打回对应阶段

不负责：
- 替代 apply 阶段的 TASK 常规状态回写
- 替代 `zsspec-code-review` 执行 `automation=static` 检查项
- 替代 `zsspec-e2e-gen` 生成 `automation=auto` 的测试代码
- 替代 `zsspec-e2e-run` 执行 `automation=auto` 检查项
- 在前置条件未满足时直接补写前序阶段应维护的常规状态
- 处理变更（发现变更应转 `zsspec-change`）
- 编写新代码

## HARD GATES

<HARD-GATE>
done 的默认行为是核对与判定，不是补写与代执行。前序 TASK / CHK 状态未收口时，不得直接更新 REQ 为 `已完成`。
</HARD-GATE>

<HARD-GATE>
未完成 `automation=static` 检查项的 code-review，或未完成 `automation=auto` 检查项的 e2e 执行，不得进入 done 完成判定。
</HARD-GATE>

<HARD-GATE>
`automation=manual` 检查项仅能由 done 或人工确认阶段更新，不得由 apply、code-review、e2e-run 提前标记通过。
</HARD-GATE>

<HARD-GATE>
若 TASK / static / auto / manual 任一未完成、未回填或缺证据，done 必须拒绝修改 REQ 状态，并明确打回对应阶段。
</HARD-GATE>

<HARD-GATE>
若验收中发现漏项、错误、边界变化或证据失效，应回到修复路径或 `zsspec-change`，不得强行标记完成。
</HARD-GATE>

<HARD-GATE>
未完成、未验证或缺证据的 CHK 检查项不得标为 `通过`。
</HARD-GATE>

<HARD-GATE>
若尚未完成 `zsspec-code-review` 或等价的结构化代码审查，不得进入 done 完成判定。
</HARD-GATE>

## 使用方式

```bash
/zsspec-done <模块>
```

## 进入条件

进入 `zsspec-done` 前，至少应满足：
- 当前模块已进入收口 / 验收阶段，且不存在未完成的主线阻塞任务
- 已完成 `zsspec-code-review`，且 `automation=static` 检查项结论允许进入验收
- 若存在 `automation=auto` 检查项，则已先完成 `zsspec-e2e-gen` 生成测试代码，并完成 `zsspec-e2e-run` 执行与状态回写，且结论允许进入验收
- 用户希望进入验收与状态同步阶段
- TASK 文档存在且可更新
- CHK 文档存在（`specs/checklist/[模块]/CHK-[模块].md`）

若仍存在 blocker、关键证据缺失或待修复问题：
- 不得标记完成
- 应先补齐前置条件，或回到修复 / `zsspec-change`

## 执行动作

1. 读取 TASK 文档的 Task Core List，判断任务完成状态
2. **读取 CHK 文档（`specs/checklist/[模块]/CHK-[模块].md`）的全量检查项，按 `automation=static/auto/manual` 分类核对状态**
3. 仅在核心表与状态不足以支撑最终判定时，再按需读取详情区、证据区、历史验证结果或相关 REQ / 设计概要
4. 先确认 `automation=static` 已由 `zsspec-code-review` 回写，`automation=auto` 已由 `zsspec-e2e-run` 回写，再处理 `automation=manual` 项
5. 若发现 TASK / CHK / review / e2e 任一未完成、未回填或缺证据，立即拒绝完成判定，并按责任阶段打回处理
6. 仅在全部前置条件满足时，基于 TASK / CHK 状态 / blocker / review 结论 / e2e 结论 / 证据 / 用户确认，更新 REQ 功能需求状态为 `已完成`

## 最低验证要求

- `automation=static` 检查项应已完成静态代码审查
- 涉及输入处理、鉴权、敏感数据、权限边界等内容时，必须补充安全审查
- `automation=auto` 检查项应已完成 e2e 执行，并保留执行报告、截图、失败栈或通过摘要
- `automation=manual` 检查项应保留人工确认、日志、截图、接口结果或外部系统验证证据
- 接口或后端变更可使用命令结果、启动日志、接口响应摘要、数据库结果等作为主要证据

## 完成判定

只有同时满足以下条件，才允许将 REQ 更新为 `已完成`：
- 所有 TASK 状态为 `已完成`
- **CHK 文档中所有检查项状态均已收口：允许值为 `通过` / `跳过` / `废弃`，不得残留 `待执行` / `失败` / `阻塞`**
- 所有 blocker 已清零
- 本次变更所需验证证据齐全
- `automation=static` 检查项已通过 code-review，`automation=auto` 检查项已完成 e2e 执行，`automation=manual` 检查项已完成人工确认
- 用户确认通过验收

否则：
- 列出剩余项、阻塞原因或缺失证据
- 拒绝更新 REQ 状态
- 按责任阶段明确打回：TASK → `zsspec-apply`，`automation=static` → `zsspec-code-review`，`automation=auto` → `zsspec-e2e-run`，`automation=manual` → 保留在 done / 人工确认，规格问题 → `zsspec-change` / `zsspec-spec` / `zsspec-brain`

## 证据要求

CHK 文档中的检查项定义了证据要求，验收时必须满足：
- 命令执行结果
- 启动日志摘要
- 浏览器截图或录屏
- 接口响应摘要
- 控制台或错误日志记录
- 其他足以支撑当前模块验收的材料

若缺少关键证据：
- 对应 TASK / CHK 检查项不得标记为 `通过`
- REQ 不得更新为 `已完成`

## 阶段输出格式

阶段收口时使用固定四段输出：

```markdown
【本阶段总结】
- 已完成验收检查
- TASK 状态：[完成数/总数]
- CHK 检查项状态：[已收口数/总数]（来源：specs/checklist/[模块]/CHK-[模块].md）
- CHK 分类汇总：static [通过/失败/待执行]，auto [通过/失败/待执行]，manual [通过/失败/待执行]

【当前结论/产物】
- REQ 状态：[已更新为已完成/保持未完成]
- 剩余项：[列表]
- 证据清单：[列表]

【风险或待确认事项】
- [blocker]
- [缺失证据]
- [未回填状态]

【下一步建议】
- 已完成：进入下一模块或项目收尾
- TASK 未完成：/zsspec-apply <模块>
- static 未完成：/zsspec-code-review <模块>
- auto 未完成：/zsspec-e2e-run <模块>
- manual 未完成：继续 done / 人工确认
- 规格有误：/zsspec-change <模块> [描述]
```

## 模块完成后的下一步

当前模块完成 done 后：
- 若存在未完成的其他模块，建议优先进入下一个"本期必做"模块
- 若本期必做模块均已完成，可建议项目整体收尾
