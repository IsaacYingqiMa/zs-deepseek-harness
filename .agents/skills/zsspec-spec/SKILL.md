---
name: zsspec-spec
description: >
  用于生成或更新模块级 spec 文档，包括 REQ、DES、TASK、CHK。当需求讨论已收敛，
  用户要"生成 spec""写需求文档""写设计文档""补任务清单""写检查清单"或更新现有 spec 时优先使用。
  不适用于模糊需求讨论、开发中变更处理、直接进入编码或完成验收；若仍有范围/方案分歧，优先回到 zsspec-brain。
---

# ZSSpec Spec - 生成规格文档

基于已收敛结论生成或更新模块级 REQ / DES / TASK，并为后续 CHK 生成提供完整输入。spec 完成后只能给出执行计划概述，等待用户明确确认后才允许进入 `zsspec-apply`。

## 职责边界

`zsspec-spec` 只负责：
- 基于模板生成或更新当前模块所需 REQ / DES / TASK 文档
- 调用 zsspec-test-gen 生成 CHK 测试用例文档，为其提供完整、可执行的规格输入
- 维护模块间的依赖关系声明
- 输出执行计划概述
- 等待用户确认后，由用户主动触发 `zsspec-apply`

不负责：
- 编写代码或执行实现
- 处理变更（由 `zsspec-change` 负责）
- 验收判定（由 `zsspec-done` 负责）

## HARD GATES

<HARD-GATE>
未经用户明确确认，禁止在 spec 生成完成后自动进入 `zsspec-apply` 或任何开发动作。
</HARD-GATE>

<HARD-GATE>
当存在模块拆分时，必须维护模块间的依赖关系，确保各模块可独立追踪。
</HARD-GATE>

## 使用方式

```bash
/zsspec-spec <模块>
/zsspec-spec <模块> --only=req
/zsspec-spec <模块> --only=des
/zsspec-spec <模块> --only=task
/zsspec-spec <模块> --only=chk
/zsspec-spec <模块> --update
```

## 模板引用

生成文档时引用模板：
- REQ: `.claude/skills/zsspec-standard/requirement/[一级模块]-[...]-[N级模块]/REQ-[一级模块]-[...]-[N级模块].md`
- DES: `.claude/skills/zsspec-standard/design/[一级模块]-[...]-[N级模块]/DES-[一级模块]-[...]-[N级模块]-前端.md` 和 `DES-[一级模块]-[...]-[N级模块]-后端.md`
- TASK: `.claude/skills/zsspec-standard/task/[一级模块]-[...]-[N级模块]/TASK-[一级模块]-[...]-[N级模块].md`
- CHK: `.claude/skills/zsspec-test-gen/SKILL.md` 中模板内容
- 全局 NFR: `.claude/skills/zsspec-standard/requirement/01-non-functional.md`

## 最小流程

1. 读取模板与当前模块已有文档，优先承接已收敛的 brain 结论
2. 生成或更新当前模块所需 REQ / DES / TASK / CHK
3. 维护模块间依赖关系声明
4. 仅在信息不足以支撑可执行文档时，再补充读取少量相关入口文件
5. 输出执行计划概述，并建议先执行 `zsspec-verify`（模块级或局部门禁）后，再等待用户明确确认进入 `zsspec-apply`

## 四类文档职责

- **REQ**：采用 `Requirement Core List`，定义做什么、边界是什么、验收标准是什么
- **DES**：采用模块级设计模板，定义前端/后端架构、数据模型、API 契约、UI 交互等设计要点
- **TASK**：采用 `Task Core List`，定义可执行任务、输出产物与 DoD
- **CHK**：由 `zsspec-test-gen` 基于 REQ / DES / TASK 生成，定义测试用例、证据要求、优先级、类型与 `automation=static/auto/manual`
- 若模块涉及性能、安全、兼容、可维护性等全局 NFR，CHK 必须补充对应检查项，不依赖单独的全局验收清单文档。

轻量模板要求：
- Core List 是默认读取入口，必须优先保证结构完整
- DES 以要点描述为主，前后端分开，不展开过长正文
- CHK 生成由 `zsspec-test-gen` 负责，spec 阶段只需保证 REQ / DES / TASK 足以支撑下游生成测试用例
- REQ 验收标准、DES 接口契约、TASK 涉及文件与技术要点必须写清楚，便于 `zsspec-test-gen` 判断 `automation=static/auto/manual`
- 若用户要求一并产出 CHK，应在 spec 完成后显式建议继续执行 `zsspec-test-gen`
- 后端 DES 涉及数据表设计时，SQL 生成须遵循 `02-data-model.md` 中的 **SQL 同步原则**
- 详情区仅按需补充，不得用长正文替代 Core List
- 历史验证结果、长日志、重复背景说明不得放入默认读取范围

## 模块依赖声明

在 REQ 文档中显式声明依赖：

```yaml
# 4. 依赖关系

## 4.1 依赖模块

| 模块 | 依赖内容 | 版本要求 |
|------|----------|----------|
| [模块A] | [接口/功能] | [版本] |

## 4.2 被依赖模块

| 模块 | 提供内容 |
|------|----------|
| [模块B] | [接口/功能] |
```

## 默认状态

- REQ 功能状态默认为 `未开始`
- TASK Core List 状态默认为 `未开始`
- CHK 检查项初始状态由 `zsspec-test-gen` 统一写为 `待执行`

## 最低质量门

- **结构完整**：当前模块所需 REQ / DES / TASK / CHK 齐全
- **一致性**：编号、模块名、路径、关联关系一致
- **可执行**：DES 能指导实现方向，TASK 可执行，CHK 可验证
- **可进入 apply**：关键歧义已收敛，已输出执行计划概述，已完成必要 verify，且仍需用户明确确认

## 阶段输出格式

阶段收口时使用固定四段输出：

```markdown
【本阶段总结】
- 已生成/更新 [模块] 的 spec 文档

【当前结论/产物】
- REQ-[模块].md [状态]
- DES-[模块]-前端.md [状态]
- DES-[模块]-后端.md [状态]
- TASK-[模块].md [状态]
- CHK-[模块].md [状态]
- 执行计划概述：[要点1]、[要点2]

【风险或待确认事项】
- [待确认项]

【下一步建议】
- 生成检查清单：/zsspec-test-gen <模块>
- 先做规格检查：/zsspec-verify <模块>
- 确认后进入开发：/zsspec-apply <模块>
- 需要调整：/zsspec-change <模块> [变更描述]
```

## 注意事项

- 若 brain 阶段已完成当前模块收敛，spec 阶段应优先直接承接，不重复回溯已确认结论
- 禁止跳过 `zsspec-apply` 直接宣称进入开发阶段
