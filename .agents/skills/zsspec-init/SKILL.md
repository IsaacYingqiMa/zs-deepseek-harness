---
name: zsspec-init
description: >
  用于初始化项目级 ZSSpec 协作入口与公共设计文档。当用户要接入 ZSSpec、
  创建或补齐 CLAUDE.md、初始化 specs/design、生成公共架构/数据模型/UI 规范时优先使用。
  不适用于模块级需求讨论、模块 spec 生成、变更处理或开发实现；这些场景分别使用其他技能。
---

# ZSSpec Init - 项目初始化

初始化项目级协作入口与公共设计文档，为后续 `zsspec-brain` / `zsspec-spec` 提供基础环境。

## 职责边界

`zsspec-init` 只负责：
- 检查并补齐根目录 `CLAUDE.md` 的项目协作入口
- 生成或补充 `specs/design/` 下的公共设计文档
- 基于当前仓库真实状态沉淀项目级已知事实与约束

不负责：
- 生成模块级 REQ / TASK
- 覆盖用户已有的 `CLAUDE.md` 主体内容
- 臆测技术栈、数据库、模块边界或部署方案

## HARD GATES

<HARD-GATE>
`CLAUDE.md` 已存在时，只追加缺失的项目约定内容，不得整文件覆盖。
</HARD-GATE>

<HARD-GATE>
只能写入仓库中已确认存在的技术栈、目录分层、工程边界、已有模块与约束；无法确认的内容保留为待补充，不得主观补全。
</HARD-GATE>

## 初始化范围

| 文档类型 | 路径 | 用途 |
|----------|------|------|
| 项目协作入口 | `CLAUDE.md` | 项目级流程、技能优先级、协作总规则 |
| 公共架构设计 | `specs/design/01-architecture.md` | 项目整体架构与分层 |
| 公共数据模型 | `specs/design/02-data-model.md` | 项目级核心数据结构与隔离约定 |
| 公共 UI/UX 规范 | `specs/design/03-ui-ux.md` | 项目级界面与交互规范 |
| API 契约规范 | `specs/design/04-api-contract.md` | 项目级 API 规范与错误码定义 |
| 中间件配置 | `specs/design/05-middleware.md` | 缓存、消息队列等中间件配置 |

## 使用方式

```bash
/zsspec-init
```

## 执行动作

1. 检查根目录 `CLAUDE.md` 是否存在
2. 若缺少项目协作入口、研发流程、命令速查或 ZSSpec 关键规则，则只补缺失部分
3. 读取公共设计模板：
   - `.claude/skills/zsspec-standard/design/01-architecture.md`
   - `.claude/skills/zsspec-standard/design/02-data-model.md`
   - `.claude/skills/zsspec-standard/design/03-ui-ux.md`
   - `.claude/skills/zsspec-standard/design/04-api-contract.md`
   - `.claude/skills/zsspec-standard/design/05-middleware.md`
4. 读取非功能需求模板：
   - `.claude/skills/zsspec-standard/requirement/01-non-functional.md`
5. 读取验收检查清单模板：
   - 参照`.claude/skills/zsspec-test-gen/skill.md`的要求
6. 扫描目录结构、技术栈、关键配置与代码，提取项目级已确认事实
7. 生成或更新 `specs/design/` 下五份公共设计文档

## 完成标准

完成 `zsspec-init` 后，项目至少应具备：
- 一个已存在且可作为项目协作入口的 `CLAUDE.md`
- 一组基于仓库真实状态生成或更新的 `specs/design/` 公共设计文档
- 一个可继续进入模块级 `zsspec-brain` / `zsspec-spec` 的基础环境

## 阶段输出格式

阶段收口时使用固定四段输出：

```markdown
【本阶段总结】
- 已初始化/更新了哪些文档

【当前结论/产物】
- CLAUDE.md [状态]
- specs/design/ [文件列表]

【风险或待确认事项】
- [待确认项]

【下一步建议】
- 进入需求讨论：/zsspec-brain <需求>
- 生成模块 spec：/zsspec-spec <模块>
```

## 后续衔接

公共设计文档初始化完成后：
- 需求讨论进入 `/zsspec-brain <需求>`
- 模块级文档生成进入 `/zsspec-spec <模块>`
- 开发前仍需执行 `/zsspec-apply <模块>`
