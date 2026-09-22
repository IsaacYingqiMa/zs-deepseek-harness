---
name: zsspec-standard
description: >
  ZSSpec 文档模板规范技能。提供标准化的需求、设计、任务、检查清单模板，
  供其他 ZSSpec 技能引用。不直接执行，作为模板库使用。
---

# ZSSpec Standard - 文档模板规范

本文档定义 ZSSpec 开发模式所需的全部模板规范，包括文件结构、命名规则、版本管理。

详细命名规范见: `rules/01-spec-rules.md`

## 模板目录结构

```
zsspec-standard/
├── SKILL.md                             # 本文档
├── rules/                               # 规则规范
│   ├── 01-spec-rules.md                 # 命名规范文档
│   └── 02-search-rules.md               # 检索最小化规则
├── brainstorming/                       # 需求讨论模板
│   └ BRAIN-[一级模块]-[...]-[N级模块].md
├── requirement/
│   ├── 01-non-functional.md             # 全局非功能需求模板
│   └── [一级模块]-[...]-[N级模块]/
│       └ REQ-[一级模块]-[...]-[N级模块].md
├── design/
│   ├── 01-architecture.md               # 全局架构设计模板
│   ├── 02-data-model.md                 # 全局数据模型模板
│   ├── 03-ui-ux.md                      # 全局UI/UX规范模板
│   ├── 04-api-contract.md               # 全局API契约模板
│   ├── 05-middleware.md                 # 全局中间件模板
│   └── [一级模块]-[...]-[N级模块]/
│       ├── DES-[模块]-前端.md
│       └ DES-[模块]-后端.md
├── task/
│   └── [一级模块]-[...]-[N级模块]/
│       └ TASK-[一级模块]-[...]-[N级模块].md
└── checklist/
    └── [一级模块]-[...]-[N级模块]/
        └ CHK-[一级模块]-[...]-[N级模块].md
```

## 引用方式

其他技能引用模板时，使用以下路径：

```
.claude/skills/zsspec-standard/rules/01-spec-rules.md
.claude/skills/zsspec-standard/rules/02-search-rules.md
.claude/skills/zsspec-standard/brainstorming/BRAIN-[一级模块]-[...]-[N级模块].md
.claude/skills/zsspec-standard/requirement/01-non-functional.md
.claude/skills/zsspec-standard/design/01-architecture.md
.claude/skills/zsspec-standard/requirement/[一级模块]-[...]-[N级模块]/REQ-[一级模块]-[...]-[N级模块].md
.claude/skills/zsspec-standard/task/[一级模块]-[...]-[N级模块]/TASK-[一级模块]-[...]-[N级模块].md
```

## 命名规范摘要

| 类型 | 格式 | 示例 |
|------|------|------|
| 功能需求 | REQ-{模块}-{功能} | REQ-用户管理-用户新增 |
| 非功能需求 | NFR-{类型}-{子项} | NFR-性能-响应时间 |
| 任务 | TASK-{模块}-{功能}-{中文标识} | TASK-用户管理-用户新增-后端接口 |
| 检查项 | CHK-{模块}-{功能}-{中文标识} | CHK-用户管理-用户新增-核心验证 |

## 版本管理

- 文档版本: `v{主}.{次}`，如 v0.1
- 详细变更规则见: `rules/01-spec-rules.md`

### 核心规则

- 新建文档设为 v0.1；功能变更次版本号 +1；重大变更主版本号 +1
- 小修改（错别字、格式、状态变更）不更新版本号
- 变更时须在文档末尾追加变更记录

## 状态定义

| 状态 | 说明 |
|------|------|
| 未开始 | 尚未开始工作 |
| 进行中 | 正在进行中 |
| 已完成 | 已完成验收 |
| 已废弃 | 不再需要 |

## 优先级定义

| 优先级 | 说明 |
|--------|------|
| P0 | 核心必须 |
| P1 | 重要 |
| P2 | 后续迭代 |

## 阶段输出格式

所有阶段在收口、切换、阻塞、决策时必须使用固定四段输出：

```markdown
【本阶段总结】
- ...

【当前结论/产物】
- ...

【风险或待确认事项】
- ...

【下一步建议】
- ...
```

## 使用约束

1. **模板不直接编辑**：通过 zsspec-spec 等技能基于模板生成实际文档
2. **状态即时同步**：状态变更应即时回写，不累计到 done 阶段
