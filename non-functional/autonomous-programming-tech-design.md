# 自主编程平台：技术架构设计

> **版本**：v1.0（技术架构设计稿）
> **读者**：CTO、首席架构师、平台研发 Lead
> **配套文档**：`autonomous-programming-report.md`（面向 CTO + 工程总监的立项报告，含痛点诊断、市场对标、ROI 测算、立项申请）
> **本文不重复**：痛点 P1-P9、市场对标、ROI 计算、立项请示
> **本文要做的事**：把"在 DSH 上怎么搭、为什么这么搭、按什么顺序搭"讲清楚，每条决策都给依据
> **状态**：技术方案，可立项评审

---

## 目录

- [§0 读者指引](#0-读者指引)
- [§1 总体架构：四层栈](#1-总体架构四层栈)
- [§2 为什么选 DSH 作为 runtime](#2-为什么选-dsh-作为-runtime)
- [§3 核心架构：生成与验证分离](#3-核心架构生成与验证分离)
- [§4 DSH 上的具体实现](#4-dsh-上的具体实现)
- [§5 演进路线：5 阶段 6-9 个月](#5-演进路线5-阶段-6-9-个月)
- [§6 风险与回退条件](#6-风险与回退条件)
- [§7 Abstraction Layer：防 DSH 锁定](#7-abstraction-layer防-dsh-锁定)
- [§8 与现有 zsspec 资产的关系](#8-与现有-zsspec-资产的关系)
- [§9 整体技术决策清单](#9-整体技术决策清单)
- [§10 总结](#10-总结)
- [附录 A：DSH API 速查表](#附录-adsh-api-速查表)
- [附录 B：术语表](#附录-b术语表)

---

## §0 读者指引

| 如果你是… | 应读… |
|---|---|
| 想了解"为什么这么做"的架构师 / 资深工程师 | §1 §2 §3 §4 |
| 想了解"下一步怎么落地"的工程师 Lead | §4 §5 §8 |
| 想评估风险的架构评审委员会 | §6 §7 §9 |
| 想了解术语的读者 | 附录 B |
| 想直接看 DSH 的哪些 API 被用到 | 附录 A |

本文假设读者已知：
- zsspec 9-stage 流水线现状（brain / spec / test-gen / verify / apply / code-review / e2e-gen / e2e-run / done）
- 9 个痛点（P1-P9）已识别，第一性原理"生成/验证分离"已成立
- Hermes→Claude Code POC 已跑通完整链路
- 4 个项目已用 zsspec 端到端验证
- 团队 15 人持续使用 zsspec

如果上述假设不成立，请先读 `autonomous-programming-report.md`。

---

## §1 总体架构：四层栈

```
┌─────────────────────────────────────────────────────────────┐
│ L7  Platform Layer（我们做）                                  │
│   - Web 控制台 / 移动伴侣 / backlog 集成 / 通知中心 / 计费    │
├─────────────────────────────────────────────────────────────┤
│ L6  Orchestration Layer（我们做）                             │
│   - zsspec 9-stage 状态机 / Agent Team 调度 / 三路决策        │
├─────────────────────────────────────────────────────────────┤
│ L5  Runtime Layer（DSH / 可换）                               │
│   - session log / goal / subagent / skill / tools / sandbox    │
├─────────────────────────────────────────────────────────────┤
│ L4  Worker Agent（多 provider 可换）                          │
│   - Claude Code / Codex / Aider / 国产模型                    │
└─────────────────────────────────────────────────────────────┘
```

### 1.1 四层分工（一句话）

| 层 | 做什么 | 谁做 | 为什么放在这一层 |
|---|---|---|---|
| **L7 Platform** | 给团队用——看 dashboard、收通知、手机改目标 | 我们 | runtime 升级如果只能让单个开发者收益，就只省 1 个人的时间；平台让 15 人同时收益才有规模效应 |
| **L6 Orchestration** | 9 阶段状态机 + 角色班子 + 对抗式 Verifier + 三路决策 | 我们 | zsspec 的 9 stage 是流程宪法，编排层是执行它的确定性状态机；智能放 L4/L5，确定性放这里 |
| **L5 Runtime** | session log / goal / subagent / skill / tools / sandbox | DSH（或 OpenHands） | 30+ 人月的底座能力（已实现的工业级代码），自研不划算 |
| **L4 Worker** | 实际写代码 | 多个 Coding Agent（可换） | 绑定单一 Coding Agent 是商业风险（模型迭代 + 成本波动）|

### 1.2 整套架构的"为什么"

DSH 提供 L5 的核心原语（session log、goal、subagent spawn、tools waterfall、skill load、sandbox）；我们自己写 L6 的桥接层 + L7 的产品层；L4 多 provider 是必须的可换性。

**L6 + L7 是产品差异化所在，L5 是基础设施借力。**

---

## §2 为什么选 DSH 作为 runtime

### 2.1 一句话选型

> **DSH 是当前最契合 zsspec 9 stage 需求的 agent runtime**，由 deepseek-ai 维护（30+ 人月投入），core 抽象对得上持久化事件日志 + 长生命周期目标 + 多 agent 隔离 + 结构化裁决这四个 zsspec 核心场景。

### 2.2 核心能力与 zsspec 需求对照

| 能力 | DSH 原生 | zsspec 需求映射 | 一句话依据 |
|---|---|---|---|
| 持久化事件日志 | `core/session` append-only log + `session-persistence` (SQLite/JSONL) | spec / code / state 全可回放 | DSH 明确"Model-visible ⟺ logged"，事件溯源是 zsspec spec 状态的基础 |
| 长生命周期目标 | `goal/goal` + `goal-round-driver` | 跨 session 续跑（P4） | goal 跨 session/进程重启存活，round 续推防无限循环 |
| 多 agent 隔离 | `subagent/subagent` 多 provider 按名共存 + `subagent-spawn-in-process`（全新 flat scope） | Writer/Verifier 物理隔离 | DSH 文档明确"spawn gives new flat scope, not inheriting parent registrations"——隔离靠架构不靠 prompt |
| 结构化裁决 | `SubagentStartRequest.outputSchema` | Verifier 的 `{verdict, issues[], route}` | DSH 文档明确"provider validates object-rooted JSON Schema within assertObjectJsonSchema's enforced subset"——结构化契约是 DSH 原生能力 |
| 工具守卫管线 | `tools/pre-execute` / `execute` / `post-execute` waterfall | 验证 gate 挂载点 | DSH 文档明确"tools/post-execute: replace presentation content, block the result, or attach model-facing context"——验证 gate 是已声明的扩展点，不是 hack |
| Skill 加载 | `skill/skill` 注册表 + `skill-filesystem` provider + `tool-skill` | zsspec 9 skill 直接挂载 | zsspec 现有 skill 文件直接当 DSH skill 加载，零重写 |
| 沙箱 + 子进程 | `shell/` + `subprocess/`（bwrap / Landlock / Windows-ACL）| tsc / eslint / pytest / property 测试执行环境 | DSH 原生沙箱隔离，执行客观命令时不污染工作区 |
| 可观测性 | `session-telemetry`（OTel）+ `webhook/` + `interaction/` | dashboard / 通知 / 远程介入（P6/P8） | OTel 是行业标准，DSH 已有 producer |
| Hook 兼容 | `hooks-claude-code` / `hooks-codex` | 兼容你已有的 CC/Codex hooks.json | 你团队已写的 hook 不丢 |
| 协议稳定 | `core/session` SESSION_FORMAT_VERSION + 邻接迁移规则 | spec 状态写进 SessionEventMap 有版本保证 | DSH 文档明确"only structural format changes bump SESSION_FORMAT_VERSION" |

### 2.3 风险与替代

DSH 是 pre-stable API（README 自陈）。替代方案：

| 方案 | 优势 | 劣势 | 何时选 |
|---|---|---|---|
| **DSH（默认）** | 抽象对得上、DeepSeek 团队维护、Cordis 模型成熟 | pre-stable、文档以架构视角为主 | 当前推荐 |
| **OpenHands** | 完整 SWE runtime、社区大 | Docker 强依赖、改造面大 | DSH 演进停滞时切换 |
| **自研最小 runtime** | 完全可控 | 30+ 人月、3-5 年 | 上面两个都不能用时（极不可能） |

**结论**：以 DSH 为首选，OpenHands 作为 fallback 后端。两者都是 Cordis 模型（vendor），迁移成本主要是工程层面而非架构层面。

---

## §3 核心架构：生成与验证分离

### 3.1 第一性原理

> **自主编程的瓶颈不是"生成代码"，而是"可信地验证代码"**。同一个 agent 既写代码又自我判断，必然导致 reward hacking、自我认可、以及"必须有人盯着"。

### 3.2 第一性原理的工程落地

| 设计要点 | 实现 | 一句话依据 |
|---|---|---|
| Verifier 与 Writer 物理隔离 | `ctx.subagents.start('spawn', {persona, outputSchema, toolFilter: 只读})` | spawn provider 给全新 flat scope，看不到 Writer 推理——隔离靠架构不靠 prompt |
| 验证以 LLM 主导 + 命令给证据 | LLM judge 裁决 + `ctx.shell` 跑 tsc/eslint/pytest/property，exit code 是事实 | 单靠 LLM 会自欺（Cognition Kevin 32B 训练时 agent 用 try-catch fallback 骗 reward），单靠命令看不出语义——两者必须分工 |
| 三路决策兜底 | Verifier 返回 `route: fix_code / fix_spec / fix_test` → `interaction/ask-user` | 验证失败语义模糊时升级人；人不是 reviewer 而是**三选一裁判** |
| 防 reward hacking 六道防线 | 架构隔离 + 客观执行 + 激励对齐 + shrinking 最小反例 + 测试完整性扫描 + 三路决策 | Kiro + Devin + Cognition 教训的合并清单，单一防线不够 |

### 3.3 角色班子

```
┌─ 决策层（人）──────────────────────────────────────┐
│  战略 / 三路决策 / Merge                          │
└────────────────────────────────────────────────┘
                       ▲ ▲
┌─ 协调层（确定性代码 driver，非 agent）──────────────┐
│  zsspec 9-stage 状态机 + goal round 续推         │
│  监听 agent/turn-stopping 决定下一步             │
└────────────────────────────────────────────────┘
                       ▲
       ┌───────────────┴───────────────┐
       │                               │
┌──────┴─────────┐         ┌────────────┴────────┐
│ Write Lane      │         │ Verify Lane          │
│ Manager (主)    │         │ Property Translator  │
│ ├ Architect     │         │ Tier1: tsc/eslint    │
│ ├ Spec Writer   │         │ Tier2: PBT           │
│ └ Code Writer×N │         │ Tier3: smoke/e2e     │
│   (fork sub)    │         │ Tier4: Verifier ⭐    │
│                 │         │   (spawn 对抗 sub)   │
│ Git Manager     │         │ Judge LLM            │
└─────────────────┘         └──────────────────────┘
                       │
                       ▼
              ┌─────────────────────┐
              │ Debugger (按需 spawn) │
              │ 解读反例 + 修复建议  │
              └─────────────────────┘
```

### 3.4 角色职责与 DSH 实现

| 角色 | 实现形态 | DSH 关键 API | 一句话职责 |
|---|---|---|---|
| **Manager** | 主 agent + sdd-pipeline-orchestrator skill | `ctx.agents`, `ctx.goals`, `ctx.skills` | 跨项目编排 + backlog 分发；**确定性 driver 在它之上**，自身不做语义判断 |
| **Architect / Brain** | 主 agent + zsspec-brain skill | `ctx.skills.get('zsspec-brain')` | 需求澄清 + 边界收敛；**唯一与人高频交互** |
| **Spec Writer** | `fork` subagent + zsspec-spec skill | `ctx.subagents.start('fork', {persona, prompt})` | 写 REQ/DES/TASK/CHK |
| **Property Translator** ⭐ | skill（确定性翻译）| `ctx.skills` + 模板引擎 | CHK → 可执行 property（Hypothesis/fast-check）|
| **Code Writer** | `fork` subagent + zsspec-apply skill | `ctx.subagents.start('fork' or 'claude-code', ...)` | 写代码，**多 provider 并行** |
| **Verifier** ⭐ | `spawn` subagent + 对抗 persona + `outputSchema` + 只读 toolFilter | `ctx.subagents.start('spawn', {persona, outputSchema, toolFilter: 只读, agentOptions: {model: 不同模型}})` | 对抗式审查，**看不到 Writer 推理** |
| **Debugger** | `spawn` subagent + 反例注入 | `ctx.subagents.start('spawn', {prompt: [<counterexample>]})` | 解读 shrinking 最小反例 + 给修复建议 |
| **Git Manager** | 工具调用 | `ctx.shell` (git), GitHub API tools | 创建 PR、跑 CI、读 CI 反馈 |
| **Human** | 交互 + 命令 | `interaction/ask-user`, `interaction/commands` | 三路决策 + merge + 战略点 |

### 3.5 验证阶梯（4 级，便宜→贵）

| Tier | 内容 | LLM？ | 何时 | 一句话 |
|---|---|---|---|---|
| 1 | tsc/eslint/mypy | ❌ 纯命令 | 每次改动 | 编译错、类型错、明显 lint 错秒级拦截 |
| 2 | property-based testing（LLM 写 property → 机器跑 100+ 随机输入 + shrinking） | 写 / 不跑 | 每个 task 完成 | 比单测强（覆盖想不到的边界）+ 比 LLM 自评可靠（反例客观）|
| 3 | 真集成 smoke + e2e | 解读 | 阶段末 | Devin 复盘的"分水岭"——mock 测试通过 ≠ 真集成通过 |
| 4 | 独立 Verifier 对抗审查 | ✅ 独立 LLM | 阶段收口 | 对照 spec + diff + 客观证据，输出结构化 `{verdict, issues[], route}` |

**诚实声明（PBT 适用边界）**：property-based testing **不适合 UI / API 编排 / 副作用代码**——这类主要靠 Tier 3 兜底。**不指望 PBT 覆盖一切**。

### 3.6 单阶段验证循环（编排的具体形态）

```
对每个阶段：
  1. 派发 Writer（注入规格上下文 + 强制引用规格段落）
  2. Writer 产出 + 声称完成
  3. 按"便宜→贵"顺序跑验证阶梯：
     Tier1 静态 → 通过才进
     Tier2 property → 通过才进
     Tier3 行为/集成
  4. 三级都过 → 派发独立 Verifier 做 Tier4 对抗审查
  5. Verifier 返回 PASS / FAIL（带具体问题 + 对应 spec 引用 + 证据）
  6. FAIL → 把问题喂回 Writer 重做（有界重试，≤3 次）
  7. 重试用尽 或 问题语义模糊 → 触发"三路决策"升级人
  8. 更新状态机 + 检查点（断点续跑）
```

### 3.7 防 Reward Hacking 六道防线

| # | 防线 | 手段 | 一句话 |
|---|---|---|---|
| 1 | 架构隔离 | Verifier 与 Writer 上下文隔离，看不到对方推理 | DSH spawn provider 原生保证 |
| 2 | 客观执行 | property 由机器跑，不靠 LLM 口头通过 | exit code 是事实 |
| 3 | 激励对齐 | Verifier 的职责是"找问题"，不是"放行" | persona 设为对抗式 prompt |
| 4 | 最小反例 | shrinking 让问题无处遁形 | Hypothesis/fast-check 自带 |
| 5 | 测试完整性 | 命令侧扫描 `skip` / `mock 吞错` / `删断言` 等作弊 | driver 层 grep |
| 6 | 三路决策 | 模糊处强制人裁决，不给 agent 自圆其说的空间 | `interaction/ask-user` |

### 3.8 三路决策（人类介入的唯一常规形态）

| 选项 | 含义 | 谁的责任 |
|---|---|---|
| **修代码** | 实现错了 | Writer / Debugger |
| **修规格** | 规格本身错 / 含糊 | **人**（规格是人的责任）|
| **修测试** | property 翻译错了 | Property Translator |

> **这是"减少人的精力"的核心机制**：人的角色从"监工"变成"裁判"——每次介入是几秒的选择题，不是持续盯守。这正是痛点 P8 的解药。

---

## §4 DSH 上的具体实现

### 4.1 zsspec → DSH 的桥接（不重写 zsspec）

| 桥接点 | DSH API | 一句话 |
|---|---|---|
| zsspec 9 skill 加载 | `ctx.skills` + `dsh-skill-filesystem` provider（指向 zsspec 目录） | zsspec 现有 skill 文件直接当 DSH skill 加载，零重写 |
| 模块 state file（YAML）| 升级为自定义 `SessionEventMap` 扩展（`zsspec/stage-change` 事件）+ session projection | session log 比 YAML 更可靠（append-only + 跨 session 自动持久化） |
| handoff pack（你的模板）| 升级为 subagent `prompt` 数组（spec + diff + 命令输出）| DSH 的 subagent prompt 天然支持结构化注入 |
| 决策表（decision-table-zs.md）| 升级为 driver 的确定性规则（重试次数、升级 trigger）| 决策表的"什么时候升级人"是确定性规则，driver 实现更可靠 |
| 14 个 references / 12 个 templates | 通过 skill filesystem provider 提供 | 模板和 references 是 skill 体系的一部分，不是 runtime 的事 |

### 4.2 阶段 driver（确定性，不智能）

**实现思路**：
- 一个 Cordis service（`ZsspecPipelineDriver`），监听 `agent/turn-stopping` 事件
- 读当前 stage（从 session projection）→ 派发对应 worker（spawn/fork subagent + skill）→ 等结果 → 推进 stage
- **完全不做语义判断**——语义由 Verifier 子 agent 给结构化裁决

**为什么 driver 必须是确定性代码，不是 LLM**：
- LLM 编排 = 把"人盯"问题挪到编排层，信任问题没解决
- 确定性代码 = 派发/重试/升级/检查点 4 件事可单元测试、可审计
- **智能放在 Worker 和 Verifier**，**确定性放在 driver**——这是分层原则

**DSH 实现锚点**：
- `ctx.subagents.start(name, request)` 派发
- `ctx.goals.create/get/edit` 持久化目标
- `agent/turn-stopping`（serial 事件）触发推进
- 自定义 `SessionEventMap` 事件（`zsspec/stage-change`）落盘阶段状态

### 4.3 Verifier subagent 的关键设计（DSH 原生契合）

```typescript
// DSH SubagentStartRequest 的关键字段
{
  provider: 'spawn',              // ← 全新 flat scope，看不到 Writer 推理
  persona: '<adversarial prompt>', // ← 对抗式 system prompt
  outputSchema: {                  // ← 结构化裁决，DSH 原生契约
    verdict: 'PASS' | 'FAIL' | 'AMBIGUOUS',
    issues: [{ spec_ref, problem, evidence, severity }],
    route: 'fix_code' | 'fix_spec' | 'fix_test',
  },
  toolFilter: { mode: 'allow', tools: ['read', 'grep', 'glob'] }, // ← 只读
  agentOptions: { model: '<different model>' }, // ← 可换模型，避免同源放水
  prompt: [
    spec_content,                  // ← 只注入这些，不注入 Writer 自述
    diff,
    command_outputs,
  ],
}
```

**Verifier subagent 输入白名单**（保证对抗性）：
- 规格（REQ / DES / CHK）
- 代码 diff / 相关文件
- 验证命令的客观输出（exit code、反例、覆盖率）

**明确不注入**（防污染）：
- Writer 的自述、推理过程、"我觉得我做好了"之类的话

**Verifier subagent 输出契约**：
```json
{
  "verdict": "PASS" | "FAIL" | "AMBIGUOUS",
  "issues": [
    { "spec_ref": "CHK-003", "problem": "...", "evidence": "...", "severity": "blocker" }
  ],
  "route": "fix_code" | "fix_spec" | "fix_test" | null
}
```

**为什么 Verifier subagent 这套设计是对的**（每点一句依据）：
- **spawn provider 物理隔离**：DSH 文档明确说"spawn gives new flat scope, not inheriting parent registrations"
- **outputSchema 强制结构化**：DSH 文档明确"provider validates object-rooted JSON Schema"
- **persona 对抗 prompt**：DSH 文档明确"persona as scoped deployment:persona section on the child"
- **toolFilter 只读**：DSH 文档明确"scoped tools.restrict() in the child's creation window"
- **不同模型**：DSH subagent 多 provider 共存设计允许
- **输入白名单**：driver 层执行，架构不靠 prompt 守

### 4.4 多 agent 并行（Manager + Worker 池）

**DSH 原生支持**：
- `ctx.subagents` 多 provider 注册：spawn-in-process、fork-in-process、claude-code、codex、dsh-sdk
- `ctx.workflowEngine` 跑脚本 fan-out：`agent(prompt, {schema})` + `parallel()` + `pipeline()`
- `ctx.goals` 多 goal queue + `goal-round-driver` 自动续推

**Manager 的工作模式**：
1. 收到 backlog（GitHub Issue / Linear / 自建 queue）
2. 创建 goal（每个项目/feature 一个）
3. 派发 Worker subagent（fork for Writer，Spec Writer 派 Architect + Spec Writer）
4. 等 Worker 完成 → 跑 Verify Lane → 推进或升级
5. **Manager 自己的 LLM 不做"够不够好"的判断**——只做调度

**为什么 Manager 用 LLM 实现但行为要确定性**：
- Manager 的"理解"用 LLM（看懂 backlog、判断哪些能并行）
- Manager 的"调度"用 driver（创建 goal、派发 subagent、记录阶段）
- 这就是 §3.2 原则的体现——智能在调度层之上，确定性在 driver

### 4.5 跨 session 续跑

**DSH 解决方案**：`core/session` + `session-persistence` (SQLite/JSONL) + `core/goal` + `goal-round-driver`

**为什么这套机制**：
- session log 是单一事实源（DSH 原则"Model-visible ⟺ logged"）
- goal 跨 session/进程重启存活（`goal/change` 事件持久化）
- round 续推：每个 goal round = 一次推进，避免无限循环

**对你 zsspec 的映射**：
- 你的 `module-state.yaml`（手工 atomic write）→ 升级为 session log 事件
- 你的"每次重启 Hermes 要重新读 state"→ 升级为 `ctx.goals.resume()` + `ctx.agents.resume()`

### 4.6 远程介入

**DSH 解决方案**：
- `dsh-webhook` 接收外部 HTTP POST 命令
- `interaction/commands` 注册 `/goal pause` / `/goal rewind-to:brain` 等
- `interaction/user-approval` / `tool-ask-user` 处理三路决策弹窗
- `session-telemetry` + dashboard 被动可见

**移动伴侣层（我们做）**：通过 webhook bridge Telegram/飞书/Slack，把 DSH 的命令系统对外暴露。

### 4.7 Verifier 实现形态对比

这是落地时绕不开的工程决策：对抗式 Verifier 到底用什么形态实现？

| 实现形态 | 上下文隔离性 | 复用 zsspec | 实现复杂度 | 能否对抗 | 适合的角色 |
|---|---|---|---|---|---|
| **A. Skill（同上下文）** | ❌ 低（共享编排上下文）| ✅ 高 | 低 | ❌ 会看到 Writer 自述 | Property Translator |
| **B. 独立 Subagent** | ✅ 高（独立上下文）| 中 | 中 | ✅ 物理隔离 | **Verifier / Debugger（首选）** |
| **C. 独立进程（新起 CC 实例）** | ✅ 最高（完全隔离）| 低 | 高 | ✅ 完全隔离 | 重场景 / 强对抗 |
| **D. DSH scoped agent.ctx** | ✅ 高（scope 隔离）| 中 | 中 | ✅ 隔离 | DSH 环境默认 |

**明确推荐**：
- **Property Translator → 用 skill**——确定性翻译，复用 `zsspec-verify` 改造即可，不需隔离，成本最低
- **Verifier（对抗审查）→ 必须用独立 subagent**——整套方案的信任基石，**绝不能用 skill**
- **Debugger → 用 subagent**——需要新鲜视角看最小反例

---

## §5 演进路线：5 阶段 6-9 个月

> **总投入**：1 名架构师 + 1 名资深工程师 × 6-9 个月（约 80-120 万人民币，含人力 + 工具）
> **每阶段独立可交付**：M1 跑通 = 验收；M2 跑通 = 验收；不需要全做完
> **M1 失败的红线**：若 M1 跑不通 → 假设"分离式 Verifier + PBT"错 → **回退到现有 zsspec 优化**，不切换 runtime

### 5.1 Phase 1（M1，1 个月）：验证"分离式 Verifier"假设

**唯一目标**：证明"Writer/Verifier 隔离 + PBT 验证"在 zsspec 1 个项目上真的有效。

**关键工作**：
1. 起 `dsh-zsspec-app` bundle（dsh-base + skill + tool-subagent）
2. `dsh-skill-filesystem` 指向 zsspec skill 目录
3. 写 `dsh-zsspec-verifier`（spawn 对抗 subagent + outputSchema）
4. 选 1 个示范项目跑 5 个 feature

**验收标准**（可量化）：
- 5 个 feature 端到端跑通
- Verifier 抓到的真 bug 数 ≥ LLM 自评
- 人工介入次数下降 ≥ 50%

### 5.2 Phase 2（M2，1 个月）：阶段 driver + 跨 session 续跑

**关键工作**：
1. 写 `dsh-zsspec-pipeline` Cordis service（确定性 9 stage 状态机）
2. 用 `core/goal` + `goal-round-driver` 做自动续推
3. session-persistence 落盘（SQLite）
4. 自定义 `SessionEventMap` 扩展 `zsspec/stage-change`

**验收标准**：
- 1 个项目跑通 9 stage 闭环，session 崩溃后 30 秒内自动 resume
- 三路决策路由到 ≤ 3 次/feature

### 5.3 Phase 3（M3，1 个月）：Manager + 多 Worker 并行

**关键工作**：
1. Manager agent + sdd-pipeline-orchestrator skill
2. 多 Worker 并行（CC + Codex + Aider provider 共存）
3. backlog → 自动派工（GitHub Issue webhook）
4. `ctx.workflowEngine` 用作 verify 阶梯 fan-out

**验收标准**：
- 单 Manager 同时管 3-5 个并行项目
- Backlog → PR 平均 < 30 分钟
- 一性成功率 ≥ 70%

### 5.4 Phase 4（M4-M5，2 个月）：平台层骨架

**关键工作**：
1. Web 控制台（自部署，React + DSH `client/` UI 组件）
2. 多 DSH runtime 实例管理（一个项目一个 runtime）
3. 通知中心（飞书 / Slack / Telegram webhook bridge）
4. backlog 集成（GitHub / Linear / Jira）
5. 移动伴侣骨架（PWA 即可，不必原生）

**验收标准**：
- 团队能在 Web 上看到所有 agent 状态
- 跨项目 dashboard
- 手机能 pause/resume

### 5.5 Phase 5（M6+，探索性，3 个月+）：Agent Team 完整版

**关键工作**：
1. 自主维护类 agent（Dependabot-style / FlakyGuard-style）
2. 三层架构（Planner / Worker / Judge）——**前提是 L4 已稳固**
3. Trust boundaries（哪些决策 subagent 自主、哪些升级）
4. 跨项目并行（多 Manager 协同）

**何时不做**（来自 Swarmia 经验）：
- 你的问题**复杂且串行**——单 agent 更高效
- L3/L4 还没稳固——**不要跳级**
- 多 agent 调试难度**类别上**更高，先把单 agent 调通

### 5.6 整体时间线

```
M1         M2         M3         M4    M5         M6+
|---------|---------|---------|-----|---------|-----------|
│ Phase 1  │ Phase 2  │ Phase 3  │ Phase 4 │  Phase 5  │
│ 验证假设  │ 持久化  │ L4 并行  │ 平台层  │ 探索 L5   │
│ 1 月      │ 1 月    │ 1 月     │ 2 月   │ 3 月+     │
└──────────┴─────────┴─────────┴──────┴─────────┴─────
0  1     2     3      4    5      6      7      8      9 月
```

### 5.7 资源估算

| 阶段 | 人力 | 主要工作 | 累计投入（人月） |
|---|---|---|---|
| M1 | 1 架构师 + 1 资深工程师 | bundle + verifier POC | 2 |
| M2 | 同 | driver + 持久化 | 4 |
| M3 | 同 | Manager + 多 Worker | 6 |
| M4-M5 | + 1 前端 | 平台层骨架 | 10 |
| M6+ | 同 | Agent Team 完整版 | 12+ |

---

## §6 风险与回退条件

### 6.1 风险与缓解

| 风险 | 严重度 | 缓解 | 依据 |
|---|---|---|---|
| **DSH 演进风险**（API 变化 / 维护节奏放慢）| 🟠 中 | abstraction layer 隔离；保留 OpenHands 作为 fallback 后端 | DSH README 自陈 pre-stable；Cordis 模型在 OpenHands 中也通用 |
| **多 runtime 一致性** | 🟠 中 | 平台层用事件溯源，不依赖各 runtime 本地状态 | DSH session log 已经是 event-sourced 模式 |
| **reward hacking** | 🔴 高 | 6 道防线（架构隔离 + 客观执行 + 激励对齐 + shrinking + 测试完整性扫描 + 三路决策）| Kevin 32B + Devin 复盘共同教训 |
| **token 成本失控** | 🟡 中 | per-phase budget cap + 分级触发（低风险只跑 Tier1/2） | 多 subagent + property 测试 token 高是有意取舍 |
| **M1 假设证伪** | 🟠 中 | 回退到现有 zsspec 优化（不切换 runtime） | "先验证价值再选载体"原则 |
| **商业化路径不明** | 🟡 中 | 先内部场景（15 人），再决定产品化 | Devin / AgentsRoom 都从内部起步 |

### 6.2 回退条件（什么信号出现就停）

| 信号 | 处理 |
|---|---|
| 连续 2 周一性成功率无提升 | 暂停优化，回顾 spec 体系本身 |
| 安全事件（agent 写错文件/删库/泄密） | 立即暂停，全员排查 |
| 团队满意度持续下滑（>2 周） | 暂停推广，先解决采纳问题 |
| Token 成本超过预算 2 倍 | 暂停，切国产模型或限流 |
| **M3 评估后 ROI 不达标** | 停止主线，回到现有 zsspec 优化 |
| **M2 末如果验证有效但 DSH 演进不及预期** | 评估切换到 OpenHands 或自研最小 runtime |
| **M1 假设"分离式 Verifier"证伪** | 回退 zsspec 优化，不切换 runtime |

### 6.3 诚实承认的"做不到"

- **业务边界判断无法自主**——必须人
- **架构选型责任无法转移**——必须人
- **Merge 决策无法自动**——必须人
- **跨领域重大变更无法自主**——必须人
- **自主不是 100% 替代人工**——是解放 50% 以上注意力（目标 75%），不是 100%

---

## §7 Abstraction Layer：防 DSH 锁定

> **这是最关键的工程设计，不是可选项。**

### 7.1 为什么必做

DSH README 自己声明 pre-stable API。Abstraction layer 让"切换 runtime"成为**配置项**，不是重写。

### 7.2 设计原则

- **L5 Runtime 抽象为 `AgentRuntime` 接口**（我们的内部接口，不是 DSH 的）
- 当前实现：`DSHRuntimeAdapter`（包 DSH 的 subagent / goal / skill / tools）
- 未来实现：`OpenHandsRuntimeAdapter`（包 OpenHands 的 runtime abstraction）
- 所有 L6 编排代码只调 `AgentRuntime` 接口，**不直接调 DSH API**

### 7.3 接口核心方法

```typescript
interface AgentRuntime {
  // 目标管理
  createGoal(objective: string, maxRounds: number): Promise<GoalId>
  getGoal(agentId: AgentId): Promise<GoalView | null>
  advanceGoal(ref: GoalRef, change: GoalChange): Promise<void>
  blockGoal(ref: GoalRef, code: string, reason: string): Promise<void>
  completeGoal(ref: GoalRef): Promise<void>

  // 子 agent
  spawnSubagent(req: SubagentSpec): Promise<SubagentRun>
  sendMessage(sender: AgentId, target: AgentId, content: ContentBlock[]): Promise<MessageId>
  interrupt(target: AgentId, authority: Authority): Promise<void>

  // 会话
  getSession(agentId: AgentId): Promise<SessionView>
  appendSessionEvent(sessionId: SessionId, event: SessionEvent): Promise<void>

  // 事件订阅
  subscribe(events: EventFilter): AsyncIterable<Event>

  // 可观测性
  emitTelemetry(metric: Metric): Promise<void>

  // 人类介入
  notifyHuman(channel: NotificationChannel, message: NotificationMessage): Promise<void>
  askHuman(req: AskRequest): Promise<AskResponse>

  // Skill 加载
  loadSkill(name: string): Promise<SkillBody>
  listSkills(): Promise<SkillSummary[]>
}
```

### 7.4 实现要点

- **adapter 层放在 `packages/runtime-adapter/`**（独立包）
- **当前唯一实现是 `packages/runtime-adapter-dsh/`**
- 所有 L6 代码 import 自 `runtime-adapter/`，不 import 自 DSH 任何包
- DSH API 变化时，只改 adapter，不改 L6

### 7.5 迁移触发条件

| 触发 | 行动 |
|---|---|
| DSH 主线 6 个月无新发布 | 评估切换到 OpenHands |
| DSH API breaking change 影响核心调用 | 在 abstraction layer 内做兼容 shim |
| DSH 项目废弃 | 切换到 OpenHands（已预留 adapter） |
| 我们需要 L5 不支持的能力 | 在 abstraction layer 扩展接口 |

---

## §8 与现有 zsspec 资产的关系

### 8.1 资产复用清单

| zsspec 资产 | DSH 化方式 | 工作量 |
|---|---|---|
| 9 个 zsspec skill | 通过 `dsh-skill-filesystem` 直接挂载 | 0 |
| 14 个 references（pitfalls）| 进入 skill 内容 | 0 |
| 12 个 templates（stage-definitions / handoff-pack / decision-table 等）| handoff-pack → subagent prompt；stage-definitions → driver 规则；decision-table → 确定性路由 | 重构 ~3 天 |
| sdd-pipeline-orchestrator skill | 升级为 Manager agent 加载 + Driver 协作 | 重构 ~3 天 |
| Hermes → CC POC | 升级为 DSH runtime + claude-code provider | 迁移 ~1 周 |
| module-state.yaml | 升级为 session log 事件 + session projection | 迁移 ~1 周 |

### 8.2 核心原则

> **zsspec skill 内容不动，只换底层 runtime 与编排方式**。

这是你过去 4 个项目积累的资产，不能浪费。

### 8.3 复用检查清单

M1 启动前必须验证：
- [ ] 9 个 zsspec skill 能被 `dsh-skill-filesystem` 正确加载
- [ ] 每个 skill 的 body 注入到 subagent prompt 后能正确执行
- [ ] zsspec 的模板（handoff-pack / decision-table）能映射到 abstraction layer 接口
- [ ] module-state.yaml 数据能迁移到 session log 事件

---

## §9 整体技术决策清单

> 这是给 CTO 看的最终决策总览。每条都是一句"为什么"。

| # | 决策 | 选择 | 一句话理由 |
|---|---|---|---|
| 1 | Runtime 底座 | DSH | 30+ 人月免费搭车，抽象对得上 zsspec 需求 |
| 2 | 阶段编排方式 | 确定性 driver（代码）| 智能放 worker，编排保持确定（防"人盯挪层"）|
| 3 | Writer/Verifier 关系 | spawn subagent（独立上下文）| 物理隔离靠架构不靠 prompt（防 reward hacking）|
| 4 | Verifier 契约 | outputSchema 结构化 | `{verdict, issues[], route}` 是 DSH 原生支持的契约 |
| 5 | 验证主导 | LLM 主导 + 命令给证据 | 单 LLM 会自欺（Kevin 32B），单命令看不出语义 |
| 6 | 人类介入方式 | 三路决策（修代码/规格/测试）| 人不是 reviewer，是裁判——选择题不是审阅 |
| 7 | 多 Coding Agent | DSH 多 provider 共存 | 商业风险（模型迭代+成本波动）+ 商业护城河（可插拔）|
| 8 | 防 DSH 锁定 | abstraction layer | DSH pre-stable；切换 runtime 是配置项不是重写 |
| 9 | zsspec 资产处理 | 不重写，挂载为 skill | 4 个项目沉淀不能浪费 |
| 10 | 平台层 | 我们自己写（AgentsRoom 级别）| runtime 是商品，平台是产品差异化 |
| 11 | 演进策略 | 5 阶段，每阶段独立可验收 | M1 失败回退到 zsspec 优化，不切换 runtime |
| 12 | 诚实声明 | 自主是解放 70% 注意力，不是 100% | 工程诚实比营销话术重要 |

---

## §10 总结

### 10.1 方案（一句话）

> 用 DSH 当 runtime，自己做编排层 + 平台层，把 zsspec 9 stage + Writer/Verifier 隔离 + 4 级验证阶梯 + 三路决策落到 DSH 的具体 API 上（spawn subagent + outputSchema + tools waterfall + goal/session 持久化）。

### 10.2 为什么（一句话）

> DSH 提供 70% 所需原语，我们只需写 30% 桥接；zsspec 资产完全保留；abstraction layer 防 DSH 锁定。

### 10.3 路径（一句话）

> 5 阶段 6-9 个月，2 人，每阶段独立可验收。

### 10.4 失败红线（一句话）

> M1 验证假设不成立 → 回退 zsspec 优化，不切换 runtime。

---

## 附录 A：DSH API 速查表

> 本文档用到的所有 DSH API 一览。每个 API 给出一句话用途 + 文档章节出处。

| API | 用途 | 出处 |
|---|---|---|
| `ctx.agents.create / resume` | 创建 / 恢复 agent + session | core/agent |
| `ctx.subagents.start(name, request)` | 启动一次性子 agent | subagent |
| `ctx.subagents.startContinuable(spec)` | 启动可续推子 agent | subagent |
| `ctx.subagents.sendMessage` / `interrupt` | 子 agent 通信 / 中断 | subagent |
| `ctx.goals.create / get / edit / pause / resume / complete / block / clear` | 目标生命周期管理 | goal/goal |
| `ctx.skills.get(name)` | 加载 skill body | skill/skill |
| `ctx.skills.list()` | 列出所有 skill | skill/skill |
| `ctx.skills.register / registerProvider` | 注册 skill / provider | skill/skill |
| `ctx.tools.register(defineTool(...))` | 注册工具 | core/tools |
| `ctx.shell.execute(command)` | 执行 shell 命令（沙箱内）| shell |
| `ctx.subprocess.spawn` | 启动子进程 | subprocess |
| `ctx.session-telemetry.emit(metric)` | 发射 OTel 指标 | session-telemetry |
| `ctx.sessions.flush(session)` | 强制 checkpoint 持久化 | session-persistence |
| `ctx.invariants` | 注册运行时不变量检查 | runtime-diagnostics |
| `ctx.commands` | 注册人类命令（如 `/goal pause`）| interaction |
| `ctx.user-approval` / `ctx.tool-ask-user` | 人类审批 / 提问 | interaction |
| `ctx.webhook` | 接收外部 HTTP POST | webhook |
| `ctx.sessionProjections` | 跨 session 派生状态 | session-projection |

### A.1 事件订阅清单

| 事件 | 模式 | 用途 |
|---|---|---|
| `agent/pre-step` | waterfall | 进入下一步前（注入 spec、决定 reject/enter）|
| `agent/turn-stopping` | serial | turn 结束触发 driver 推进 stage |
| `tools/post-execute` | waterfall | 工具调用后（验证 gate 挂载点）|
| `tools/pre-execute` | waterfall | 工具调用前（policy / deny）|
| `subagent/start` | emit | 子 agent 启动（用于 dashboard）|
| `subagent/end` | emit | 子 agent 结束（用于 telemetry）|

### A.2 自定义事件扩展（SessionEventMap）

```typescript
// 在你的包中扩展
declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    'zsspec/stage-change': {
      data: {
        stage: 'brain' | 'spec' | 'test-gen' | 'verify' | 'apply' | 'code-review' | 'e2e-gen' | 'e2e-run' | 'done'
        module: string
        revision: number
      }
    }
    'zsspec/verify-result': {
      data: {
        stage: string
        verdict: 'PASS' | 'FAIL' | 'AMBIGUOUS'
        tier: 1 | 2 | 3 | 4
        evidence?: Record<string, unknown>
      }
    }
    'zsspec/three-way-decision': {
      data: {
        issueId: string
        route: 'fix_code' | 'fix_spec' | 'fix_test'
        userChoice?: 'fix_code' | 'fix_spec' | 'fix_test' | 'defer'
      }
    }
  }
}
```

---

## 附录 B：术语表

| 术语 | 定义 |
|---|---|
| **Agent** | DSH 中一个独立的 LLM 驱动单元，有自己的 session、context、tools |
| **AgentRuntime（我们内部接口）**| abstraction layer 的核心接口，封装任何 runtime 后端 |
| **Abstraction Layer** | 把 DSH / OpenHands 等 runtime 包装成统一 `AgentRuntime` 接口，避免锁定 |
| **Capability Seam** | DSH 的能力边界抽象（Service Definition / Provider / Consumer 三件套）|
| **Checkpoint** | session 状态快照，用于崩溃恢复 |
| **Cold Resume** | 从持久化存储恢复 agent + session |
| **Driver（阶段）** | 我们的 zsspec 9 stage 确定性状态机（不是 agent，是代码）|
| **DSH** | DeepSeek Harness，本方案选用的 runtime（基于 Cordis）|
| **Fork Provider** | DSH subagent provider，子 agent 带父历史种子（inherits context）|
| **Goal** | DSH 长生命周期目标抽象，跨 session 存活 |
| **Goal Round** | goal 自动续推的一次推进单位 |
| **HITL** | Human-in-the-Loop，人类介入 |
| **HARD-GATE** | zsspec 中"未经用户确认不得跨过"的硬规则 |
| **Isolation（上下文隔离）**| spawn provider 给子 agent 新 flat scope，看不到父对话 |
| **Manager Agent** | 我们的多项目编排 agent，自身不做语义判断 |
| **outputSchema** | DSH subagent 启动参数，强制结构化 JSON 返回 |
| **PBT** | Property-Based Testing，属性测试（Hypothesis / fast-check）|
| **persona** | DSH subagent 启动参数，per-child 系统提示 |
| **Project Memory** | 跨 session 持久化的项目记忆（workspace 级别）|
| **Property Translator** | zsspec 角色，把 CHK 翻译为可执行 property |
| **Provider（DSH）** | 多实现并存的能力提供方（如 subagent 的 spawn / fork / claude-code）|
| **Reward Hacking** | agent 通过钻空子骗过验证（注释测试、try-catch fallback 等）|
| **Round Cap** | goal 的最大续推轮数（防失控）|
| **Session** | DSH 的 append-only 事件日志 |
| **SessionEventMap** | DSH 的事件类型注册表（merge-extensible）|
| **Shrinking** | PBT 失败时把反例压缩成最小可复现形式 |
| **Skill** | DSH 中可加载的指令集（你的 zsspec skill 是这种形态）|
| **Spawn Provider** | DSH subagent provider，给全新 flat scope（不继承父）|
| **Spec Coverage** | 代码覆盖了多少 spec 段落（用于 P1 验证）|
| **Stage（zsspec）** | 9 个 SDD 阶段之一 |
| **Subagent** | DSH 中的子 agent（one-shot 或 continuable）|
| **Three-way Decision（三路决策）**| 验证失败时让用户选修代码/规格/测试 |
| **Tier（验证）**| 4 级验证阶梯中的某一级 |
| **ToolFilter** | DSH subagent 启动参数，限制子 agent 可用工具 |
| **Verifier** | 与 Writer 物理隔离的对抗式审查角色 |
| **Writer** | 实际产出代码 / spec 的 agent |

---

> **文档结束**
>
> 本文与 `autonomous-programming-report.md` 配套：那份给老板看需求和 ROI，这份给架构师和工程师看怎么搭。
> 如有疑问或需要深挖某节，请联系作者。
