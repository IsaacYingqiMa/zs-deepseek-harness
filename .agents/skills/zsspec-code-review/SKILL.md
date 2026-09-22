---
name: zsspec-code-review
description: >
  用于基于模块 specs 对本次代码改动执行低噪声、高相关、以 Agent 编排为核心的代码审查。
  当用户说"帮我review代码""做代码审查""检查本次改动有没有问题""合并前看一下"时优先使用。
  不适用于需求讨论、spec 生成、开发前 spec 校验或最终验收；若尚未收敛审查范围，先收敛 scope 再 review。
---

# ZSSpec Code Review - 基于 Specs 与 Agent 编排的代码审查

对本次代码改动执行**以 specs 为判据、以 CHK 中 `automation=static` 检查项为核心输入、以 Agent 为执行器、以低噪声高置信为目标**的结构化代码审查。

它不是 lint，也不是泛化的“帮我看看代码”，而是回答两个问题：

1. 这次代码改动是否**正确落地了 REQ / DES / CHK 中属于 `automation=static` 的检查项 / NFR**？
2. 这次代码改动是否存在**真实的实现风险、回归风险或阻断 static 类验收的问题**？

`zsspec-code-review` 不负责检查 TASK 状态，也不替代未来 e2e 阶段去完成真实交互或运行链路验证。

核心原则只有一句：

> 只报与本次改动相关、与 specs 或真实实现风险有关、并且有证据支撑的问题。

## 职责边界

`zsspec-code-review` 只负责：
- 对当前模块、本次子功能或当前 diff 执行结构化代码审查
- 基于 REQ / DES / CHK 中 `automation=static` 的检查项 / NFR 判断代码是否符合规格
- 基于实现现实判断是否存在 correctness、contract、security、regression、review-acceptance 风险
- 使用多 Agent 分维度发现问题，并对高风险 finding 做复核
- 输出少量高价值、可执行、可追溯的问题与下一步建议
- 回写 CHK 中 `automation=static` 检查项的状态，并在进入 `zsspec-done` 前提供代码质量门结论

不负责：
- 检查 TASK 状态、TASK 完成度或 apply 阶段进度同步
- 替代 `zsspec-e2e-run` 执行 `automation=auto` 检查项
- 替代 `zsspec-done` 处理 `automation=manual` 检查项
- 替代 lint、formatter、类型检查、单元测试、CI
- 替代 `zsspec-verify` 做开发前 spec 门禁校验
- 直接修改 spec 文档（spec 问题应转 `zsspec-change` / `zsspec-spec` / `zsspec-brain`）
- 默认做全仓历史债务巡检或风格化代码评审
- 替代未来 e2e 阶段做真实交互、联动链路或运行场景验证
- 替代 `zsspec-done` 做最终验收结论

## HARD GATES

<HARD-GATE>
进入 `zsspec-done` 前，必须先完成 `zsspec-code-review` 或等价的结构化代码审查。
</HARD-GATE>

<HARD-GATE>
若存在 Critical finding，或存在阻断型 Major finding，不得进入 `zsspec-done`。
</HARD-GATE>

<HARD-GATE>
若 review 发现根因在 spec 而不是纯代码实现，不得在 review 中强行判为“通过”；必须回退 `zsspec-change`、`zsspec-spec` 或 `zsspec-brain`。
</HARD-GATE>

<HARD-GATE>
默认忽略纯 style、纯命名偏好、与本次 scope 无关的历史问题，不得把 review 退化为 lint 报告。
</HARD-GATE>

<HARD-GATE>
没有代码证据、逻辑证据或必要验证支撑的问题，不得进入主报告。
</HARD-GATE>

## 使用方式

```bash
/zsspec-code-review <模块>
/zsspec-code-review <模块> --focus=<子功能>
/zsspec-code-review <模块> --scope=diff
/zsspec-code-review <模块> --scope=module
/zsspec-code-review <模块> --mode=dev
/zsspec-code-review <模块> --mode=merge
/zsspec-code-review <模块> --mode=audit
/zsspec-code-review <模块> --only=correctness
/zsspec-code-review <模块> --only=contract
/zsspec-code-review <模块> --only=security
/zsspec-code-review <模块> --only=regression
/zsspec-code-review <模块> --only=acceptance
/zsspec-code-review <模块> --range=<base..head>
/zsspec-code-review <模块> --full
```

## Scope 设计

| scope | 含义 | 目标 |
|---|---|---|
| `diff` | 审查当前工作区改动或指定 commit range | 低噪声、最常用 |
| `module` | 审查当前模块相关改动与模块内关键实现 | 模块级收口 |
| `pr` | 审查一个 PR 级变更集合 | 预留二期扩展 |

默认规则：
- 默认由系统**自动判断**范围
- 小改动、聚焦明确时优先 `diff`
- 改动分散、跨多个关键文件、仅看 diff 无法解释设计语义时升级为 `module`
- 若范围仍不清，先追问用户或先收敛 `focus`

## mode 设计

| mode | 目标 | 默认输出 |
|---|---|---|
| `dev` | 开发中自检 | Critical + Major，少量观察项 |
| `merge` | 合并前 / done 前正式门禁 | Critical + Major，输出更严格 |
| `audit` | 深度专项审查 | Critical + Major + 适量观察项 |

默认 `mode=dev`。

## 核心输入

### 1. Specs 判据

默认按以下顺序读取：
1. 用户当前诉求、本轮补充要求、最近明确确认的口头约束
2. REQ 的当前模块 / 当前子功能 Requirement Core List
3. DES 的设计要点、API 契约、状态流、异常路径
4. CHK 中 `automation=static` 的检查项、审查要点、证据要求、优先级与类型
5. NFR 与模块 CHK 中属于静态可审查的项

读取约束：
- `zsspec-code-review` 默认不以 TASK 作为审查依据，也不检查 TASK 状态
- CHK 中 `automation=auto` / `manual` 的项只用于识别后续待验证范围，不在本阶段判定通过

### 2. 代码现实

默认按以下顺序读取：
1. 当前 diff 或指定 range
2. 改动文件的最小必要上下文
3. 受影响调用点、关键状态流、接口定义
4. 仅当需要复核高风险 finding 时，再补读更多上下文或验证证据

读取原则：
- 先读最小集合，后补读必要详情
- 先读 spec，再读代码
- 任何扩展读取都必须服务于当前 finding 或当前结论
- 不得默认扫完整仓库历史与无关模块

## 双轨审查模型

### 轨道 A：Review Checklist Compliance Review

回答：**代码是否满足 specs 中可由静态审查完成的检查项？**

重点检查：
- 是否漏实现 REQ 中需要由 `automation=static` 检查项覆盖的关键功能点
- 是否与 DES 的接口契约、字段语义、状态流、异常路径冲突
- 是否满足 CHK 中 `automation=static` 的检查项定义、审查要点、证据要求与验收口径
- 是否让 `automation=static` 检查项难以验证或无法形成静态证据
- 是否违反 NFR 或模块 CHK 中属于静态可审查的要求

### 轨道 B：Code Risk Review

回答：**即使符合 specs，代码实现是否仍有高风险问题？**

重点检查：
- correctness：逻辑错误、边界条件、状态流转
- contract：API / DTO / schema / 错误码 / 向后兼容
- security：输入校验、权限边界、敏感数据、注入、越权
- regression：回归风险、耦合点、兼容性、影响范围
- acceptance：可测性、可验证性、证据链是否充足

## Agent Orchestration

`zsspec-code-review` 借鉴了两类能力：
- **Superpower 的流程纪律**：request review、receive review、verification-before-completion
- **Claude Code 的 Agent 编排思路**：specialized agents + verification + orchestration

### 角色分工

| Agent | 职责 | 主要依据 |
|---|---|---|
| orchestrator | 收敛范围、读取 specs、分派 reviewer、聚类去重、裁决输出 | 全部 |
| correctness-reviewer | 审查逻辑正确性、边界条件、状态流转 | REQ + DES + diff |
| contract-reviewer | 审查 API、字段、错误码、数据结构、兼容性 | DES + REQ + diff |
| security-reviewer | 审查输入校验、权限边界、敏感数据、越权风险 | NFR + REQ + diff |
| regression-reviewer | 审查影响范围、回归风险、耦合点 | diff + surrounding code + DES |
| acceptance-reviewer | 审查 `automation=static` CHK 的可达性、可测性、证据链支撑 | CHK(static) + REQ + DES + diff |
| finding-verifier | 对高风险 finding 进行复核、反驳、确认 | finding + code + spec + 必要验证 |

### 编排顺序

1. orchestrator 明确模块、focus、scope、mode
2. 读取最小必要 specs 与当前改动范围
3. 并行派发专项 reviewer
4. 聚合 findings，做去重、聚类、初步分级
5. 仅把高风险 findings 派给 `finding-verifier`
6. 根据 verifier 结果保留、降级或丢弃 finding
7. 输出最终 review 报告与下一步动作

### reviewer 输出约束

每个 reviewer 默认只提交：
- 与本次 scope 强相关的问题
- 可回溯到 spec 或真实实现风险的问题
- 具有明确代码位置和影响说明的问题

不得默认提交：
- 纯 style / 命名偏好
- 无法证实会出错的猜测性风险
- 与本次改动无关的历史债务
- 过度泛化的“也许可以更好”建议

## 降噪机制

这是 `zsspec-code-review` 的核心能力。

### 三重门

| Gate | 通过条件 |
|---|---|
| Relevance Gate | 必须与本次 scope / diff / 模块相关 |
| Spec Gate | 必须能回溯到 REQ / DES / TASK / CHK / NFR，或属于真实实现风险 |
| Confidence Gate | 必须有代码证据、逻辑证据或必要验证证据 |

不满足任一门：
- 不进入主报告
- 最多进入观察项，或直接丢弃

### 默认忽略项

| 类型 | 默认处理 |
|---|---|
| 纯 style 问题 | 忽略 |
| 纯命名偏好 | 忽略 |
| 与本次改动无关的历史问题 | 忽略 |
| 低置信优化建议 | 忽略 |
| 缺少 spec 依据且非真实实现风险的问题 | 忽略 |

### 控量规则

| 规则 | 说明 |
|---|---|
| 主报告优先聚类同根因问题 | 避免一因多报 |
| Major finding 默认最多展开 5 条 | 超出时按根因或影响面合并 |
| 观察项默认最多 3 条 | `--full` 才展开更多 |

## Finding 分级模型

### 严重度

| 级别 | 含义 |
|---|---|
| Critical | 真实缺陷、安全问题、契约破坏、验收阻断、明显错实现 |
| Major | 高概率缺陷、明显漏实现、严重回归风险、关键验收隐患 |
| Warning | 有风险但证据较弱或影响次级 |
| Suggestion | 可选优化 |

### 置信度

| 级别 | 含义 |
|---|---|
| High | 有明确代码 / 逻辑 / 验证证据 |
| Medium | 有较强迹象，但未完全验证 |
| Low | 依赖猜测 |

### 主报告规则

默认主报告展示：
- 所有 `Critical`
- 所有与当前 scope 强相关、证据充分的 `Major`

默认不展示：
- `Warning`
- `Suggestion`
- `Low confidence` finding

若使用 `--full`：
- 可展开少量 `Warning`
- 仍不应把输出写成 lint 报告

## 审查结论模型

| 结论 | 含义 | 条件 | 后续动作 |
|---|---|---|---|
| 通过 | 当前改动未发现阻断问题 | 无 Critical；无阻断型 Major | 可进入 `zsspec-done` |
| 有问题需修复 | 存在 Major 或可控阻断项 | 无 Critical；存在需要修复的 Major | 修复后复审 |
| 阻断 | 存在不能忽略的严重问题 | 任一 Critical；或高影响结构性问题 | 不得进入 `zsspec-done` |
| 需回退 spec | 根因在 spec 而非纯实现 | 需求、设计、边界或验收口径本身有误 | 转 `zsspec-change` / `zsspec-spec` / `zsspec-brain` |

## 进入条件

进入 `zsspec-code-review` 前，至少应满足：
- 当前模块已有 REQ / DES / TASK / CHK
- 已经发生代码变更，且能收敛到明确审查范围
- 用户希望在继续验收、继续开发或合并前获得结构化审查结论

若不满足：
- 不得给出完整 review 结论
- 应先收敛 scope、补齐 spec，或明确改动范围

## 执行动作

1. 明确模块、focus、scope、mode
2. 读取最小必要 specs
3. 读取当前 diff 或指定 range 的最小必要代码上下文
4. 从 CHK 中筛出 `automation=static` 的检查项，建立本轮审查清单
5. 执行双轨审查：static checklist compliance + code risk
6. 并行派发专项 reviewer，聚合 findings
7. 对高风险 findings 执行 verifier 复核
8. 仅对已真实通过且具备静态证据的 `automation=static` 检查项回写状态为 `通过`
9. 输出固定格式的 review 报告与下一步建议

## 输出格式

```text
Code Review 报告
════════════════════════════════════
模块：<模块>
范围：<diff / module / range>
聚焦：<子功能 / 无>
模式：dev / merge / audit
结论：通过 / 有问题需修复 / 阻断 / 需回退 spec
检查结果：<static检查项通过数> 通过 / <失败数> 失败 / <观察数> 观察
已回写 static 检查项：<数量>
待后续 auto / manual：<数量>

[Critical] <标题>
- 关联 spec：REQ-... / DES-... / CHK-...
- 代码位置：<file:line>
- 问题：<一句话>
- 影响：<为什么严重>
- 证据：<代码或验证依据>
- 建议：<修复方向>

[Major] <标题>
- 关联 spec：...
- 代码位置：...
- 问题：...
- 影响：...
- 证据：...
- 建议：...

观察项：
- 无
或
- O-001: <问题>
- O-002: <问题>

建议动作：
- 继续验收：/zsspec-done <模块>
- 修复后复审：/zsspec-change <模块> [描述]
- 若 spec 有误：/zsspec-spec <模块> --update
════════════════════════════════════
```

## 输出要求

- 必须先给结论，再给问题
- 主报告默认只放高价值 finding
- 默认忽略 style、命名偏好、纯优化建议
- 不得把 review 写成 lint 报告或全仓巡检报告
- 每条 finding 必须说明：关联 spec、代码位置、影响、证据、建议方向
- 若结论为“通过”，应明确写出“可进入 done”
- 若结论为“需回退 spec”，必须明确给出去向

## 与其他阶段的衔接

- `verify` 负责审 spec 能否开工；`code-review` 负责审代码是否按 spec 正确落地
- 开发中重要任务完成后，可执行 `/zsspec-code-review <模块>` 做中途自检
- 进入 `zsspec-done` 前，必须先完成 code-review
- review 发现纯实现问题 → `/zsspec-change <模块> [修复描述]`
- review 发现 spec 错误、边界错误、设计契约问题 → `/zsspec-spec <模块> --update` 或 `/zsspec-brain <模块>`
- review 通过仅代表 `automation=static` 检查项已完成；`automation=auto` / `manual` 检查项仍需由后续阶段继续完成
- review 通过后，才建议在其他必需验证完成后进入 `/zsspec-done <模块>`

## 触发时机

| 时机 | 建议级别 | 推荐 mode |
|---|---|---|
| 重要任务完成后 | 强烈推荐 | `dev` |
| 进入 done 前 | 强制通过 | `merge` |
| 大改动 / 重构后 | 强烈推荐 | `merge` 或 `audit` |
| 用户手动要求审查 | 随时可触发 | 按目标选择 |

## 关键原则

- review 先看 spec，再看代码
- review 先做范围收敛，再做问题发现
- review 必须低噪声、高相关、可追溯
- review 的价值在于发现真实问题，不在于多报问题
- review 默认只围绕本次改动，不扩展成历史债务扫描
- review 发现 spec 问题时，必须分流，不得强行在当前阶段掩盖根因
