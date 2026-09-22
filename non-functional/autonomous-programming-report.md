# 自主编程 OS 调研报告与演进路线

> **版本**：v0.1（内部研讨稿）
> **目的**：建立对"自主编程"的统一认知，明确研发链路中可自主化的边界，基于现有 zsspec 体系规划可落地的演进路径
> **状态**：探索阶段，进入立项讨论

---

## §0 Executive Summary

**现状结论**：我们当前最大的瓶颈不是 AI 写代码的能力，而是**工程师的注意力被各个阶段之间的判断与验证消耗**。自主编程不是替换工程师，而是把"阶段转换 + 验证"从"人盯"变成"可信地自动跑"。我们已具备基础（zsspec 多个项目端到端 + Hermes→CC POC），现在只需落地**生成/验证分离**（独立对抗 Verifier + 可执行规格 + 分级验证 + 三路决策），就能把每个阶段的人工介入压缩，并跑出可验证的 POC。

**三个关键数字**：

| 维度 | 现状 | 目标 |
|---|---|---|
| 每个阶段人工介入 | ~1 小时打磨/检查 | ≤ 15 分钟（异常态） |
| 一性成功率（CC 跑完无需 rewind） | 低（apply 经常失焦） | ≥ 70% |
| 单人并行项目数 | 2–3 个，最多 4 个 | 4–6 个 |


**为什么是现在**：市场已证明这条路可行（Devin AI、OpenHands、SWE-agent 均已上线）；团队对 AI 自主已有共识但缺乏统一框架；zsspec 已沉淀的多个项目经验是稀缺资产——再不做，竞争对手的同类工具进入后我们将付出更高的切换成本。

**我的判断是**：上面这三个"为什么"中，**第二点团队已有共识但缺乏框架**是这次的最大的需求点。技术随时可以补，但团队共识一旦错过窗口就散了——3个月后大家被各种AI工具碎片化，反而更难统一路线。**现在做不是"要不要做"，是"再不做就晚了"**。

---

## §1 背景与动机：为什么自主编程是必答题

### 1.1 现状盘点

| 维度 | 数据 |
|---|---|
| zsspec 使用规模 | 公司内部 20 人试点，**15人持续使用** |
| 已验证项目数 | 4 个完整模块端到端跑通 |
| 个人并行项目上限 | 2–3 个（最高 4 个） |
| 每个 feature 平均工期 | **3 天** |
| 每个阶段平均耗时 | ~1 小时（仔细检查更久） |
| Hermes→CC POC | 已跑通完整链路，但不完善 |
| 现有协作工具 | Hermes（supervisor）+ Claude Code（implementer）+ zsspec skill 体系 |

### 1.2 当前痛点：工程师注意力被三类工作牵扯

我观察我自己的时间被以下三个环节**牵扯**，而且**这三类工作都难以批量复制**：

1. **需求拉扯**——与产品/业务方来回澄清 spec 边界，往往一次 spec 确认需要 2 小时以上
2. **验收 spec 文档**——读完 4 份 spec（REQ / DES / TASK / CHK）后判断是否可开工
3. **调试 agent 生成的代码 + 评测 agent 效果**——这是当前**最耗精力**的环节

更具体的：

* agent 失效"拉扯改 bug"是普遍情况，**一次成型率较低**
* apply 阶段 agent **不会完整阅读所有 spec 文档**，经常失焦
* verify 阶段需要"扯皮很多次"才能确认可开工
* 当前主要靠**盯着 agent 验收产物**作为质量保证手段

#### 痛点消耗量级（15 人团队月度估算，待 1 周调研精确化）
**P1** apply 失焦（返工）
**P2** verify 扯皮（spec 验收）
**P3** 调试 agent 代码
**P4** 跨 session 续跑
**P5** 并行项目瓶颈
**P6** 需求拉扯
**P7** 一性成功率低（评测）

**我认为**：现在主要的工程师时间被这 7 类机械工作吞噬。这不是"AI 写不好代码"的问题，而是**结构性的注意力浪费**。这正是自主编程要解决的事。

### 1.3 当前 AI 工具的覆盖边界

我们已经在用的工具栈：

| 工具 | 覆盖范围 | 缺什么 |
|---|---|---|
| Claude Code / Cursor | 单会话多文件任务 | 跨天续跑、跨项目状态 |
| Hermes + zsspec | 多阶段 SDD 流水线 | **阶段间验证自动化** |
| 我们的鸿沟 | — | **长生命周期 + 跨 session 状态 + 真·验证反馈循环** |

### 1.4 错失窗口的成本

* **团队注意力是最稀缺资源**——15 人 × 每阶段 1 小时 × 每天多次阶段转换 ≈ 每天数小时被机械判断消耗
* **并行项目数被验证瓶颈卡住**——不是开发能力，是同步协调能力
* **不做的成本 = 持续低 ROI + 团队注意力被持续低效任务占用**
* **竞争对手正在进入**——Devin AI已经服务真实工程团队，我们需要先把内部的流程跑通，让自己先用起来，对AI自主有信心

### 1.5 同事真实痛点采集（与 P1-P9 互补）

> 这一节是 2026-09 与团队同事沟通后补充的**真实反馈**，与 §1.2 抽象出来的 P1-P9 形成"现象-机制"互证。同事痛点更"具体可感知"，P1-P9 更"结构性根因"。

#### 同事 A（后端）：需求拉扯阶段

> "我和产品来回澄清 spec 边界要 2 小时，AI 能不能直接出标准 spec 文档？"

具体表现：

* AI 是否能完整理解我的意图？我说的话常带"应该""可能""大概"，AI 照单全收写出的 spec 我得逐字改
* AI 转出来的 REQ / DES / TASK / CHK 四份文档，是否真把我的意思复述全了？我没法穷举"可能漏的点"
* 遇到不确定的地方 AI 不会反问，一次给我一版"看似完整"的稿子，实际有 3-5 个关键点它猜错了我没发现
* 反复 3-4 轮才能收敛到一个"我可以确认"的版本

#### 同事 B（全栈）：开发完成后的验收

> "现在很多 AI 写的代码一次成型率还是很低，经常漏功能。"

具体表现：

* spec 写了但代码没实现——apply 阶段失焦，agent 没读完所有 spec 段落就开始写
* spec 根本没提的边界，agent 也没主动问，最后验收才发现"这块本来应该是什么样？"
* 单元测试通过 ≠ 真集成通过——mock 测试都过，真集成一跑就 502
* Agent 提供的"我审过了"我不敢相信，必须自己再过一遍 → 等于两遍工作

#### 同事 C（架构）：Agent OS / 编排层空白

> "我们现在没有一个完整的 Agent 管理或者说 orchestration 层，这是最初级的目的。"

具体表现：

* 多 agent 工具碎片化（Claude Code / Cursor / Aider / Codex 各用各的），没有统一入口
* 不知道一个 AI 服务"什么时候被调用、按什么方式调用"，缺乏"agent registry + capability catalog"
* 没有完整的自动化测试验收链路，每次验收靠"人盯着看"
* 缺一个能调度、分配、追踪、通知的"AI 员工管理系统"

#### 与 P1-P9 的对应关系

| 同事痛点 | 对应 P 编号 | 补强 |
|---|---|---|
| A 的"AI 不能完整理解意图 + 不反问" | **P6（需求拉扯）** + **P7（评测）** | 需要"结构化反问树"（不超过 2 个反问） |
| A 的"spec 转四份文档可能漏" | **P2（verify 扯皮）** + **P9（一性成功率）** | 需要"机器可校验字段 + REQ↔CHK 双向追溯" |
| B 的"代码一次成型率低 + 漏功能" | **P1（apply 失焦）** + **P3（调试代码）** | 需要"spec 强制 inline + 4 级验证阶梯 + 独立 Verifier" |
| B 的"mock 通过 ≠ 真集成通过" | **P3（调试代码）** | 需要"集成 TDD / 真集成 smoke"（Devin 复盘的分水岭） |
| C 的"Agent OS / orchestration 层空白" | **架构层新增** | 需要"DSH-based 完整编排层 + 用户侧 4 种触发模式 + 3 种交互层"（详见 §8） |

> **我认为**：同事痛点比 P1-P9 更"可触达"，因为它直接来自真实工作场景。但 P1-P9 更"机制性"，因为它把痛点分类、对应方案、量化收益。三者结合：一线同事提供"现象"、P1-P9 提供"机制"、§4-§6 提供"方案"——是本报告的完整结构。

---

## §2 自主性边界：哪些能自主、哪些必须人

### 2.1 完整研发链路：从 PRD 到 Merge 的 14 环节

我们把"做出来一个 feature"的完整链路拆成 14 个环节，并标注每个环节的自主可行性。

| # | 环节 | 输入 | 输出 | 当前自主等级 | 目标自主等级 | 主要评估者 |
|---|---|---|---|---|---|---|
| 1 | 需求澄清 | 用户语言 / PRD 草案 | 结构化结论 | 🟡 半自主 | 🟡 半自主 | LLM judge + **人** |
| 2 | 架构设计 | 需求 + 项目惯例 | 设计文档 | 🟡 半自主 | 🟡 半自主 | LLM judge + **人** |
| 3 | 任务分解 | 设计 | TASK 清单 | 🟢 高自主 | 🟢 高自主 | 规则引擎 |
| 4 | 验收清单（CHK） | REQ / DES / TASK | 检查清单 | 🟢 高自主 | 🟢 高自主 | 规则引擎 |
| 5 | spec 一致性（verify） | spec 全文 | verify 报告 | 🟡 半自主 | 🟢 **全自主** | 独立 Verifier + 规则 |
| 6 | 代码实现（apply） | spec + TASK | 源文件 | 🟡 半自主 | 🟢 高自主 | 命令 + 独立 Verifier |
| 7 | 单元测试 | 实现 | 测试文件 | 🟡 半自主 | 🟢 高自主 | **运行时命令** |
| 8 | 静态审查（code-review） | 实现 + CHK static | 审查报告 | 🟠 慎自主 | 🟢 **全自主** | 命令 + 独立 Verifier |
| 9 | e2e 测试生成 | 实现 + CHK auto | playwright | 🟡 半自主 | 🟡 半自主 | LLM judge |
| 10 | 真集成 smoke | 实现 + 服务 | smoke 报告 | 🔴 不跑 | 🟢 **全自主** | 命令 + LLM 解读 |
| 11 | PR 创建 | git diff | GitHub PR | 🟢 高自主 | 🟢 高自主 | **API 验证** |
| 12 | CI 反馈 | PR URL | CI 状态 | 🔴 不自动化 | 🟢 **全自主** | **API 验证** |
| 13 | Code Review（PR） | PR diff | review 报告 | 🟡 半自主 | 🟡 半自主 | LLM judge + **人** |
| 14 | Merge / 部署 | PR + review | 生产环境 | 🟠 慎自主 | 🟠 **慎自主** | **人** |

**4 个自主等级**：

| 等级 | 含义 | 当前数量 | 目标数量 |
|---|---|---|---|
| 🟢 全自主 | 无需人参与，由独立 Verifier + 命令客观证据验证 | 0 | 4 |
| 🟢 高自主 | 大部分 agent 跑，关键边界人工抽检 | 3 | 5 |
| 🟡 半自主 | agent 跑，机器 + LLM 双重 verify，人抽检 | 7 | 4 |
| 🟠 慎自主 | 机器 verify 通过，但关键决策必须人批 | 2 | 1（merge 由人批） |

### 2.2 边界原则

> **业务、需求、功能定义 = 人；状态管理、执行、验证、测试 = AI。**

| 类别 | 谁负责 | 为什么 |
|---|---|---|
| 战略对齐（"做不做、为什么做"） | **人** | 需要对组织战略负责 |
| 需求边界（"做哪些、不做哪些"） | **人** | 需要对业务理解负责 |
| 架构选型（"用什么技术栈"） | **人** | 影响长期演进 |
| 重大变更（"重构还是补丁"） | **人** | 影响范围超出 agent 视野 |
| 任务分解、spec 撰写、CHK 起草 | **AI 起草 + 独立审查 + 人兜底** | 人定需求边界（brain），AI 高效起草，独立验证，语义责任在人 |
| 代码实现、单元测试、静态审查 | **AI 跑** | 评估由运行时命令保证 |
| e2e 生成、code review | **AI 跑 + 人抽检** | 部分边界仍需人 |
| PR 创建、CI 反馈 | **AI 全自动** | API 可验证 |
| **Merge / 部署** | **人拍板** | 关键决策点 |

> **我认为**：上面 9 项决策权划分中，**前 4 项（战略/边界/架构/重大变更）在短期内不会变化**——这不是技术问题，是组织责任问题。我们方案的真正战场在"AI 起草 + 审"以下的部分，不把精力花在试图让 AI 做战略决策上。

### 2.3 决策权矩阵（按环节）

| 决策类型 | 决策权 | 验证权 | 例外升级条件 |
|---|---|---|---|
| 业务边界 | 人 | 人 | — |
| 架构选型 | 人 | 人 | — |
| spec 内容 | AI 起草 | AI 审查 + 人兜底 | 重大歧义 → 人重写 |
| verify 通过/不通过 | AI 跑命令 | 规则引擎 | 阻断问题 → AI 重跑 |
| apply 是否完成 | AI 跑命令 | 运行时命令 | 3 次失败 → 人介入 |
| code-review 通过 | AI 跑 | 运行时命令 | critical → 人审 |
| e2e pass | AI 跑 playwright | 运行时命令 | 3 次失败 → 人 |
| PR 创建 | AI 自动 | API | 权限问题 → 人 |
| Merge | 人 | 人 | — |

### 2.4 人在回路的 5 类 trigger

只有以下 5 种情况需要中断自主流程升级到人：

1. **同阶段连续 3 次失败**（agent 在某环节反复失焦）
2. **同模块 2 次回退到 brain**（spec 本身有歧义）
3. **架构偏离 hard constraints**（违反项目第一原则）
4. **引入系统级新依赖**（DB / 消息队列 / 缓存切换）
5. **merge / 部署**（关键责任边界）

其他所有环节均可自动推进。

---

## §3 市场对标：自主编程产品的能力矩阵

### 3.1 主流产品概览

| 产品 | 厂商 | 类型 | 当前定位 | 备注 |
|---|---|---|---|---|
| **Devin AI** | Cognition | 商业云服务 | 自主 SWE，从 ticket 到 PR | ~14% SWE-bench；Sub-Agent 架构；DeepWiki 知识库 |
| **OpenHands** | AllHands AI | 开源 runtime | Devin 的开源替代 | Docker sandbox；Runtime abstractions；v0+v1 架构 |
| **SWE-agent** | Princeton NLP | 学术开源 | Agent-Computer Interface 研究 | 12.29% SWE-bench；focus on ACI |
| **Claude Code** | Anthropic | 商业 CLI | 长上下文会话式编程 | 良好的 subagent 与 context engineering |
| **Codex CLI** | OpenAI | 商业 CLI | 类似 Claude Code | TBD 当前能力 |
| **Cline / Roo Cline** | 开源 | VS Code 扩展 | 任务级编码 agent | HITL 设计做得细 |
| **Cursor** | Anysphere | 商业 IDE | Composer + Tab | 接近 L3，不算自主 |
| **Aider / Plandex** | 开源 CLI | L2 任务级 | 单会话多文件 | — |

**来源**：基于各产品官方文档与公开 case study 综合评估。

### 3.2 自主等级光谱（L0–L5）

| Level | 名称 | 描述 | 代表产品 | 我们当前的位置 |
|---|---|---|---|---|
| **L0** | Inline Assist | 行内补全 | Copilot Tab | — |
| **L1** | Pair Programming | Chat + 文件级生成 | Cursor Chat, Continue.dev | 工具具备 |
| **L2** | Task Delegation | 任务级，文件级产出 | Aider, Plandex | — |
| **L3** | Project Delegation | 模块/PR 级产出 | Claude Code, Codex, Cline | **zsspec 当前所在** |
| **L4** | Production Engineering | 跨天，目标级产出 | Devin, Factory | **目标** |
| **L5** | Fleet Coordination | 多 agent 并行 + 自动任务分派 | Devin Sub-Agent | 未来 |

**关键鸿沟**：

* L2 → L3：**长上下文管理 + 多阶段状态机**
* L3 → L4：**真实反馈循环 + 可观测性 + 自愈**
* L4 → L5：**任务分解 + 跨 agent 协调 + 自我评估**

### 3.3 能力对照矩阵（在 14 环节上的自主程度）

> **评分说明**：0 = 完全无能力；1 = 起步；2 = 单次能力；3 = 多次能力；4 = 高自主；5 = 全自主（独立 Verifier + 命令客观证据验证）

| 环节 | Devin | OpenHands | Claude Code | SWE-agent | Cursor | **我们（当前）** | **我们（3 个月目标 M3）** |
|---|---|---|---|---|---|---|---|
| 1 需求澄清 | 3 | 3 | 2 | 1 | 2 | **3** | **4** |
| 2 架构设计 | 3 | 2 | 3 | 1 | 2 | **3** | **4** |
| 3 任务分解 | 4 | 3 | 3 | 2 | 2 | **3** | **4** |
| 4 验收清单 | 4 | 3 | 2 | 1 | 1 | **3** | **4** |
| 5 spec 一致性 | 4 | 3 | 2 | 1 | 1 | **2** | **5** |
| 6 代码实现 | 5 | 4 | 4 | 4 | 3 | **3** | **4** |
| 7 单元测试 | 4 | 4 | 3 | 3 | 2 | **3** | **4** |
| 8 静态审查 | 5 | 4 | 3 | 2 | 2 | **2** | **5** |
| 9 e2e 生成 | 4 | 4 | 3 | 2 | 1 | **3** | **4** |
| 10 真集成 smoke | 5 | 4 | 2 | 2 | 1 | **1** | **5** |
| 11 PR 创建 | 5 | 5 | 3 | 1 | 1 | **2** | **5** |
| 12 CI 反馈 | 5 | 4 | 2 | 1 | 1 | **1** | **5** |
| 13 Code Review | 4 | 3 | 2 | 1 | 1 | **3** | **4** |
| 14 Merge | 1 | 1 | 0 | 0 | 0 | **1** | **1**（人批） |
| **综合能力** | **3.86** | **3.21** | **2.43** | **1.43** | **1.43** | **2.36** | **4.21** |

**关键观察**：

1. **Devin 是当前商业产品的天花板**，但距离 L5 还差得很远
2. **OpenHands 是开源最好的选择**，能力略低于 Devin 但可自部署
3. **SWE-agent 偏研究**，生产可用度有限
4. **Claude Code / Codex 适合执行层**，但缺乏 orchestrator
5. **我们的目标综合能力到达 Devin**——这是基于我们对自有 codebase 和 spec 体系的原生集成优势

### 3.4 关键启示：从市场产品可以借鉴什么

| 启示 | 来源 | 我们的应用 |
|---|---|---|
| **集成 TDD 是分水岭** | Cognition 自家产品复盘 | 必加环节，覆盖到 stage 10 |
| **Sub-Agent 架构比单 agent 强** | Devin 2.0 / OpenHands | 多 module 并行执行 |
| **ACI（Agent-Computer Interface）简单优于复杂** | SWE-agent | shell + read/write + search 三件套足够 |
| **RL 后训练对窄域有效** | Kevin 32B | 我们不需要（spec 是我们的强项） |
| **HITL 三层架构（agency/workflow/runtime）** | AgentOS | apply 到我们的 14 环节上 |
| **LLM Judge 必须有 ground truth 兜底** | Cognition 案例 | judge + CI 双重验证 |
| **可观测性是 L4 的必要条件** | Devin / OpenHands | OTel + Webhook |

**我认为**：对 Devin 复盘最重要的一句话是"**集成 TDD 是分水岭**"——这是 Cognition 自家团队在多次发布后总结的结论。我们必须新增 stage 10（真集成smoke），不能再依赖mock-based测试通过就声称done。

---

## §4 我们的方案：基于 zsspec 构建自主编程 OS

### 4.1 核心判断：自主路线的 5 个取舍

**我对自主编程路线的看法是** —— 我们的方案不是"什么都做"，而是有清晰的取舍。下面 5 个取舍是后续所有架构与里程碑决策的源头。

#### 不做的 4 件事（4 个放弃）

1. **不自研 agent runtime** —— 优先复用现有/开源方案（候选：增强版 Hermes、待评估开源 runtime，M2 评估后定，见 §4.6.3）。自研 runtime 是 6-12 个月工程，与复用方案不可同日而语；但**不预先锁定任何单一平台**。
2. **不绑定单一 Coding Agent** —— Worker 层抽象为 WorkerInterface，可挂 Claude Code / Codex / 国产模型。模型成本与能力波动剧烈，单一绑定是商业风险。
3. **不一上来做多项目并行** —— M1 只跑单项目 POC。多项目并行是 M2 的工作，跨 session 续跑没验证就上并行是赌博。
4. **不替换现有 PR review / merge 流程** —— 只在 review 前自动 verify。现有流程承载团队信任，不能突然换轨。

#### 做的 4 件事（4 刀砍下去）

1. **第一刀：verify 阶段自动化** —— ROI 最高、风险最低的切入点。当前 verify 是 LLM 自评 + 人工核查，对应痛点 **P2**、**P9**，是吞噬工程师时间最严重的地方。
2. **第二刀：apply 阶段 spec 强制读取** —— 解决失焦（头号痛点 **P1**）。把相关 spec 强制到 apply 阶段内强制回读。
3. **第三刀：新增集成 smoke test TDD** —— Devin / Cognition 复盘公认的分水岭。"调试 agent 代码耗精力"（**P3**）中至少 60% 是真集成场景。
4. **第四刀：多 goal 并行 + 远程介入** —— 规模化的必经之路（对应 **P4 / P5 / P6**），但必须等前三刀验证完才投入。

#### 路线背后的判断依据

> **我认为这个路线最优，因为**：
> - 前三刀都能在 zsspec 现有 9 stage 内**增量改造**，不需要重写流水线。
> - 每一刀都有可量化的 ROI（见 §4.4 映射表与 §5.3 KPI），不是空喊口号。
> - 每一刀都可以独立 rollback —— 做坏了不会污染其他刀。
> - **如果 M1 跑不通，意味着我们对"生成/验证分离"的判断错，应回退到现有 zsspec 优化**（不会一错到底）。

#### 贯穿全局的架构第一性原理：生成与验证必须分离

上面 4 刀是"做什么"，这一条是"为什么这样做能成立"。它是整套方案的承重墙：

> **自主编程的瓶颈不是生成代码，而是可信地验证代码。当前所有Agentic编程工具的共同反模式是：同一个Agent既写代码又自我判断——这必然导致记忆奖励、自我认可，以及必有人盯着。**

因此本方案的第一性原理是：

> **在架构上把生成者（Writer）与验证者（Verifier）彻底分离，并用可执行spec task和验证清单作为客观进入下一步的门禁。**

这条原理直接决定三件事（后文 §4.5 展开）：

1. **Verifier 必须是独立的对抗角色**，不能和 Writer 共用上下文——否则它会看到 Writer 的自我辩解，失去对抗性（对应痛点 P2）。
2. **验证以 LLM/agent 为主导，但必须有命令给出客观证据**——LLM 负责理解/翻译/解读/裁决，命令负责提供不可辩驳的 exit code / 反例 / 覆盖率（对应痛点 P2 / P9）。
3. **语义模糊处用"三路决策"升级人**（修代码 / 修规格 / 修测试），把人的精力从"持续盯守"压缩成"在规格不清晰时才做决策"（对应痛点 P8）。

> **我认为**：想清楚这一条，其他所有设计都是从它推导出来的。9 个痛点追到根上是同一个问题——没有一套"不依赖人眼、也不依赖生成者自评"的可信验证机制。

---

### 4.2 现状盘点

我们已经拥有的：

| 资产 | 状态 |
|---|---|
| zsspec 9-stage skill 体系 | 已覆盖 4 个完整项目端到端 |
| 9 个 zsspec 子 skill（brain / spec / test-gen / verify / apply / code-review / e2e-gen / e2e-run / done） | 团队 15 人持续使用 |
| sdd-pipeline-orchestrator skill | supervisor 角色，9 stage 派 CC，state file 持久化 |
| Hermes→CC POC | 已跑通完整链路 |
| 14 个 references（pitfalls） | 真实的失败模式库 |
| templates 套件（stage-definitions, decision-table, handoff-pack, module-state 等） | 完整的 intent 层 |

我们已经验证的（来自 4 个项目经验）：

* SDD 流程拆分有效（脑 → 写 → 验 → 改 → 做 → 查 → e2e → 收）
* HARD-GATE 机制对质量保证有效
* YAML state file 持久化有效
* handoff pack 模板减少派发开销

我们当前的边界（来自 4 个项目教训）：

* apply 经常**不读全部 spec**——失焦是头号失败模式
* verify **扯皮很多次**——LLM 自报"我审过了"不可信
* 一性成功率低——agent 失效需要 rewind
* 跨 session 续跑不流畅——每次重新读 state 文件是手工操作

> **我认为**：zsspec 已具备 intent 层（9 stage + HARD-GATE + decision table + handoff pack），缺的只是 L4 orchestrator 与 L3 verifier。把这两层补上，整个体系就完成了从 L3 到 L4 的跃迁——这是低投入高产出的核心原因。

---

### 4.3 目标能力跃迁：从 L3 到 L4

| 维度 | 当前 L3 | 目标 L4 | 对应痛点 |
|---|---|---|---|
| 阶段间转换 | 人盯 | **runtime 自动** | P2, P9 |
| 验证机制 | LLM 自评 + 人工 | **独立 Verifier（LLM 主导）+ 命令客观证据** | P2, P3 |
| 状态持久化 | YAML 手工 atomic write | **session log + 自动 checkpoint** | P4 |
| 跨 session 续跑 | 手动重启 Hermes | **自动 resume + fork** | P4 |
| 失败回退 | 人工 rewind | **自动 rewind + retry** | P9 |
| 多项目并行 | 串行 | **并行多 goal queue** | P5 |
| 可观测性 | 飞书消息 | **OTel + 主动通知 + dashboard** | P8 |
| 远程介入 | 无 | **手机端 pause/resume/rewind** | P6 |

> **我认为**：L3 → L4 的鸿沟本质是"**谁来验证**"。当前是 LLM 自评 + 人工核查，目标是**独立 Verifier（LLM 主导）+ 命令客观证据 + 人只审 critical**。这是"自主"与"自动化"的根本区别——自动化是脚本跑，自主是"可信验证 + 异常分支自动处理 + 人只做选择题"。

---

### 4.4 痛点→方案→措施映射表（**本报告核心**）

**9 个核心痛点（P1-P9）** —— 这是后续所有讨论（架构、KPI、风险）的统一索引：

| 痛点 | 描述 | 来源 | 解决方法（OS 层） | 具体措施 | 里程碑 | 验证手段 |
|---|---|---|---|---|---|---|
| **P1** | apply 失焦（不读 spec） | §1.2 | L2 Worker + L4 Orchestrator | spec inline 到 handoff + phase 内强制回读 | **M1** | apply 后 spec 覆盖率 ≥ 95% |
| **P2** | verify 扯皮多次（LLM 自评不可信） | §1.2 | L3 验证层（独立 Verifier）| **Writer/Verifier 分离 + 对抗式审查**：独立 Verifier subagent 主导，命令（tsc/pytest/property）提供客观证据 | **M1** | Verifier 返回结构化 PASS/FAIL + 每条问题对应 spec 证据 |
| **P3** | 调试 agent 代码耗精力 | §1.2 | L3 真集成 smoke | 新增 stage 10（真集成 smoke） | **M1** | curl HTTP 200 + LLM judge 响应 shape |
| **P4** | 跨 session 续跑不流畅 | §1.4 | L1 Platform + L4 Orchestrator | 引入可持久化 runtime（M2 评估选型）+ checkpoint | **M2** | session log 持久化 + resume API |
| **P5** | 并行项目数卡在 2-3 个 | §1.1 | L4 Multi-goal Queue | 多 goal queue 实现 | **M2** | 单人管 5+ 并行 goal |
| **P6** | 远程无法介入 | §1.2 | L5 决策层 | Telegram / Webhook 命令 | **M2** | 手机端 pause/resume/rewind |
| **P7** | 需求拉扯耗时间 | §1.2 | L4 brain agent | brain agent 增强 + 知识库 | **M3** | 反问覆盖度 ≥ 8 项 |
| **P8** | 团队注意力稀缺（结构性问题） | §1.4 | 全栈——L3 自动化是核心解药 | M3 可观测 dashboard | **M3** | phase 介入时间下降 75% |
| **P9** | 一性成功率低 | §1.2 | L3 + L4 多层防护 | 4 级验证阶梯逐级快反馈 + 有界重试 + 三路决策兜底 | **贯穿 M1-M3** | 一性成功率 ≥ 70% |

**关键解读**：

- **M1（1 个月）集中解决 P1 / P2 / P3** —— 这三个都是"agent 在执行层失信"，是当前最大痛点
- **M2（2 个月）集中解决 P4 / P5 / P6** —— 这是"规模化"的前提
- **M3（3 个月）解决 P7 / P8 / P9 收尾** —— P8 是结构性问题，需要 dashboard 量化展示
- **P9（一性成功率）贯穿全程** —— 不属于某一阶段，是每一阶段的累积目标

> **我认为**：这张表是本报告最重要的产出物。后续所有讨论（架构、里程碑、KPI、风险）都从这里派生。**如果老板只读一页，就读这张表** —— 它同时回答了"痛在哪、谁来解、怎么验"。

---

### 4.5 核心架构：生成/验证分离的自主编程 OS

§4.1 给出了第一性原理（生成与验证分离），本节把它落成具体架构。分四部分：**角色班子 → 验证阶梯 → 验证循环 → 平台栈**。

#### 4.5.1 智能体角色班子（不是一个全能 agent，是一组互相制衡的角色）

自主编程不该是一个全能 agent 单打独斗，而是一组**职责单一、互相制衡**的角色。其中两个带 ⭐ 的新角色是整套方案的灵魂：

| 角色 | 职责 | 上下文 | 模型建议 |
|---|---|---|---|
| Architect / Brain | 需求澄清、边界收敛 | 与人高频交互 | 强模型（需推理）|
| Spec Writer | 写 REQ / DES / TASK / CHK | 独立 | 强模型 |
| **可执行规格翻译** ⭐ | 把 CHK 翻译成可执行 property（可执行规格）| 独立 | 强模型 |
| Code Writer | 实现代码 | 独立 | 可插拔（CC / Codex）|
| **Verifier** ⭐ | 对抗式审查，专职找问题 | **独立，不可见 Writer 推理** | 对抗 prompt / 不同模型 |
| Debugger | 解读反例、定位根因、给修复建议 | 独立 | 强模型 |
| Orchestrator | 状态机，**不是 agent** | — | 无（纯代码）|

两个关键点：

- **可执行规格翻译** 把"验收清单"从"人看的文字"变成"机器能跑的证据"——这是规格的可执行化（对应 Kiro 的核心洞察）。
- **Verifier** 是与 Writer **物理隔离**的对抗角色。它的激励是"找出问题"而非"通过审查"，且看不到 Writer 的自我辩解，只看规格 + 代码 + 客观证据。**这就是防记忆奖励的架构保证——不靠 prompt 求 agent"别骗自己"，而靠架构让它"没法自己骗自己"。**

> **编排层要"笨"，不要智能**：Orchestrator 是确定性状态机，只做派发、重试计数、升级触发、检查点，**绝不做"这个产出够不够好"的语义判断**。如果把语义判断放进编排层，等于把"人盯"问题挪到编排层，信任问题没解决。

#### 4.5.2 验证层：4 级验证阶梯（本方案的心脏）

验证按"便宜→贵"分 4 级，多数错误在低级别几秒内就被拦截，走不到昂贵的 e2e——这直接缩短反馈周期：

| 级别 | 内容 | 是否用 LLM | 成本 | 何时跑 |
|---|---|---|---|---|
| **Tier 1 静态** | 编译（tsc/mypy）+ lint（eslint/ruff）| ❌ 纯命令 | 秒级 | 每次改动 |
| **Tier 2 Property** | LLM 写 property，机器跑几百随机输入 + shrinking | ✅ LLM 写，❌ 机器执行 | 分钟级 | 每个 task 完成 |
| **Tier 3 行为** | 真集成 smoke + e2e（Playwright）| ✅ LLM 解读 | 分钟级 | 阶段末 |
| **Tier 4 对抗审查** | 独立 Verifier 对照规格审查 | ✅ 独立 LLM | 分钟级 | 阶段收口 |

**对"验证该由谁主导"的明确回答**（呼应 §4.1 第一性原理）：

> 验证**必须以 LLM/agent 为主体**，不能退化成纯 lint/规则。但要把"主观判断"与"客观证据"分开——**LLM 负责理解、翻译、解读、裁决（语义层）；命令负责提供不可辩驳的客观证据：exit code、反例、覆盖率（事实层）**。LLM 说"我觉得对了"不算数，必须有命令证据；但命令跑什么、结果怎么解读、失败怎么处理，由 LLM 主导。

**Tier 2 的关键机制——可执行规格 + 属性测试**：

```
CHK 验收项（人写的文字）
   "排序后输出应与输入等长且单调不降"
        ↓ Property Translator（LLM）翻译
可执行 Property：
   ∀ lst: len(sort(lst)) == len(lst) 且 is_monotonic(sort(lst))
        ↓ 属性测试框架（Hypothesis / fast-check）
   自动生成几百个随机输入执行
        ↓ 若失败
   反例 → shrinking 压缩成最小反例
        ↓
   最小反例喂给 Debugger 定位根因
```

为什么这比单元测试强、又比纯 LLM 自评可靠：

- **比单元测试强**：单元测试是"例子"，只测你想到的；property 是"规律"，用随机生成覆盖你**想不到**的边界。
- **比纯 LLM 自评可靠**：property 的执行是客观的、不可被 LLM 花言巧语绕过；反例是具体、可复现的。
- **对 LLM 友好**：shrinking 给出最小反例，让 Debugger 精准定位，而不是在巨大失败输入里抓瞎。

> **诚实声明（PBT 适用边界）**：property 测试最适合纯逻辑 / 数据结构 / 契约类代码（如示例的排序）。对 UI、API 编排、带副作用的集成代码，往往难以写出有意义的 property，这类主要靠 Tier 3 行为验证（smoke / e2e）兜底。我们不指望 PBT 覆盖一切——它是验证阶梯中的一级，不是全部。

#### 4.5.3 单阶段验证循环（编排的具体形态）

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

#### 4.5.4 三路决策（人类介入的唯一常规形态）

当验证失败且语义模糊时，Verifier 不硬判，而是把问题**分类后路由给人**，让人做**几秒钟的三选一**，而非半小时的逐行审查：

| 选项 | 含义 | 谁的责任 |
|---|---|---|
| 修代码 | 实现错了 | Writer / Debugger |
| 修规格 | 规格本身错 / 含糊 | 人（规格是人的责任）|
| 修测试 | property 翻译错了 | Property Translator |

> **这是"减少人的精力"的核心机制**：人的角色从"监工"变成"裁判"——每次介入是几秒的选择题，人在规格不清晰时才做决策。这正是痛点 P8 的解药。

#### 4.5.5 防 Reward Hacking 六道防线

| # | 防线 | 手段 |
|---|---|---|
| 1 | 架构隔离 | Verifier 与 Writer 上下文隔离，看不到对方推理 |
| 2 | 客观执行 | property 由机器跑，不靠 LLM 口头通过 |
| 3 | 激励对齐 | Verifier 的职责是"找问题"，不是"放行" |
| 4 | 最小反例 | shrinking 让问题无处遁形 |
| 5 | 测试完整性 | 命令侧扫描 `skip` / `mock 吞错` / `删断言` 等作弊 |
| 6 | 三路决策 | 模糊处强制人裁决，不给 agent 自圆其说的空间 |

#### 4.5.6 平台运行时栈（支撑层）

上面的角色与验证逻辑，最终跑在一个 5 层平台栈上（这一层是"运载工具"，可替换，见 §4.6.3 平台选型）：

```
┌─────────────────────────────────────────────────────────────┐
│ L5 决策层（人类）：三路决策 / 战略点 / dashboard 被动可见      │
├─────────────────────────────────────────────────────────────┤
│ L4 协调层（Orchestrator，确定性状态机）                        │
│   - Goal 状态机: 9 阶段可回退（对应 P1-P9 推进）              │
│   - Sub-agent fan-out: 多模块并行（对应 P5）                  │
│   - Checkpoint + Resume: 跨崩溃/跨天（对应 P4）              │
├─────────────────────────────────────────────────────────────┤
│ L3 验证层（4 级阶梯 + 独立 Verifier + 三路决策）               │
├─────────────────────────────────────────────────────────────┤
│ L2 执行层（Worker Agents / Tools）                            │
│   - 9 个 zsspec worker skill（保留并强化）                    │
│   - Claude Code / Codex 作为 implementer（可插拔）            │
│   - LSP / subprocess / sandbox / web / browser                │
├─────────────────────────────────────────────────────────────┤
│ L1 平台层（Runtime / Infrastructure）                          │
│   - runtime: session log / goal state / persistence           │
│   - Sandbox: bwrap / Landlock / Windows-ACL                    │
│   - Telemetry: OTel 后端 + webhook                            │
└─────────────────────────────────────────────────────────────┘
```

> **我认为**：这套架构的价值不在"又画了个分层图"，而在于它把 §4.1 的第一性原理落到了可执行的角色与流程上——**生成与验证分离、编排保持确定性、人只做选择题**。平台栈（L1-L5）只是运载工具，真正决定成败的是 L3 验证层的设计。

---

### 4.5A Verifier 的实现形态：skill vs subagent vs 独立进程

这是落地时绕不开的工程决策：**对抗式 Verifier 到底用什么形态实现？** 下面给出对比与明确推荐。

#### 四种实现形态对比

| 实现形态 | 上下文隔离性 | 复用 zsspec | 实现复杂度 | 能否对抗 | 适合的角色 |
|---|---|---|---|---|---|
| **A. Skill（同上下文）** | ❌ 低（共享编排上下文）| ✅ 高 | 低 | ❌ 会看到 Writer 自述 | Property Translator |
| **B. 独立 Subagent** | ✅ 高（独立上下文）| 中 | 中 | ✅ 物理隔离 | **Verifier / Debugger（首选）** |
| **C. 独立进程（新起 CC 实例）** | ✅ 最高（完全隔离）| 低 | 高 | ✅ 完全隔离 | 重场景 / 强对抗 |
| **D. scoped agent.ctx** | ✅ 高（scope 隔离）| 中 | 中 | ✅ 隔离 | 若 runtime 提供 scope 隔离能力 |

#### 明确推荐

- **Property Translator → 用 skill**。它是相对确定性的"规格→property"翻译，复用现有 `zsspec-verify` 改造即可，不需要隔离，成本最低。
- **Verifier（对抗审查）→ 必须用独立 subagent**。这是整套方案的信任基石，**绝不能用 skill**（理由见下）。
- **Debugger → 用 subagent**。需要"新鲜视角"看最小反例，不被 Writer 的思路带偏。

#### 为什么 Verifier 必须是 subagent 而非 skill

| 理由 | 说明 |
|---|---|
| **隔离是信任的来源** | skill 运行在编排者同一上下文，会"看到"Writer 的自我辩解与推理，对抗性被污染；subagent 独立上下文，天然隔离 |
| **可换模型/参数** | subagent 可用不同模型、不同 temperature、对抗式 system prompt，强化"找问题"倾向 |
| **可被编排管理** | 编排层能 spawn / 收集结构化结果 / 设超时，符合 §4.5.3 验证循环 |
| **对应 runtime 能力** | 若 runtime 提供 subagent scoped 隔离，可零额外造轮子 |

#### Verifier subagent 的输入/输出契约（关键设计）

**只注入这些**（保证对抗性）：

- 规格（REQ / DES / CHK）
- 代码 diff / 相关文件
- 验证命令的客观输出（exit code、反例、覆盖率）

**明确不注入**（防污染）：

- Writer 的自述、推理过程、"我觉得我做好了"之类的话

**输出结构化**（供编排层判定）：

```
{
  "verdict": "PASS" | "FAIL" | "AMBIGUOUS",
  "issues": [
    { "spec_ref": "CHK-003", "problem": "...", "evidence": "..." }
  ],
  "route": "fix_code" | "fix_spec" | "fix_test" | null   // AMBIGUOUS 时给三路建议
}
```

> **我认为**：这个"输入白名单 + 输出结构化"的契约，是把"对抗式审查"从口号变成工程的关键。Verifier 看不到 Writer 的辩解、只对着规格和客观证据挑毛病——这才是"分离"二字的真正落地。

---

### 4.6 差异化优势（含可插拔策略）

#### 4.6.1 vs 商业产品

| 维度 | Devin 等商业产品 | 我们 |
|---|---|---|
| Codebase 知识 | DeepWiki（外部构建） | **自有 codebase，原生集成** |
| Spec 体系 | 通用（无） | **zsspec 原生支持** |
| 安全合规 | 云服务（数据出公司） | **内部部署，数据不出域** |
| 流程定制 | 不可定制 | **完全可控** |
| Coding Agent 选择 | 锁定单一模型 | **可插拔（Claude Code / Codex / 国产模型）** |

> **我认为**：我们和 Devin 最大的差异不是技术，是 codebase 知识的深度 —— DeepWiki 是 Cognition 外部构建的（先有 Devin 再造 DeepWiki），而我们是**原生集成**（zsspec + 内部 codebase 是同一批人在维护）。这是商业产品短期内追不上的护城河。

#### 4.6.2 可插拔策略（不锁定 Coding Agent）

按 §4.1 的核心判断，**不依赖特定 Coding Agent**：

- **Worker 层抽象**为 WorkerInterface，可挂 CC / Codex / SWE-agent / 国产模型
- **Verifier 由独立对抗 agent 主导，命令提供客观证据**——评测权不交给"被评对象本身"（即 Writer），但验证的判断主体仍是 LLM，命令只是不可辩驳的证据（见 §4.5.2）
- **Orchestrator 层**可任意替换 coordinator 实现
- 模型成本 / 能力波动时可**热切换**

> **我认为**：这是平台化而非单一产品的设计哲学 —— 这也是为什么选择 runtime 框架（如 OpenHands 等开源 runtime）而不是直接使用 Devin 这类商业产品更适合做长期演进。**绑定一个 Coding Agent 等于把自己的命运交给一个供应商的更新节奏**。

#### 4.6.3 编排平台的选型（分阶段，不锁死）

编排平台的本质需求只有 4 条，任何平台满足即合格：①持久化状态机（断点续跑，对应 P4）②确定性阶段流转 ③带沙箱的子进程执行 ④事件/通知系统（升级、远程介入）。

| 阶段 | 平台选择 | 理由 |
|---|---|---|
| **M1（先证明验证价值）** | 沿用 Hermes，加一层轻量状态持久化（SQLite/JSON 检查点）| 不引入新平台风险，先验证"生成/验证分离"这个核心假设是否成立 |
| **M2（验证有效后）** | 评估迁移：候选 runtime（开源/自研增强版），按 §4.5 角色诉求评估 | 此时已知道验证层要什么，选型有据可依 |
| **关键原则** | **验证层与规格层必须与平台解耦** | 平台只是运载工具，换平台不应重写验证逻辑 |

> **我认为**：最该先回答的问题不是"用哪个平台"，而是"分离式验证 + 可执行规格，能否让验证可信到不需要人盯"。这个假设在 Hermes 上就能验证——**假设成立，平台选型是工程问题；假设不成立，换什么平台都白搭。先验证价值，再选载体。**

---

### 4.7 实施路径：痛点驱动的三阶段

> **每个阶段都明确解决哪些痛点** —— 这是 §4.4 映射表的执行版。每个阶段都有"对应痛点"+"具体工作"+"可量化成功标准"三件套。
>
> **时间安排**：三阶段各 1 个月，顺序推进，总计 3 个月（与 §5.2 / §7.1 一致）。

#### 阶段 1（M1，第 1 个月）：砍掉 P1 / P2 / P3

**目标**：在 1 个示范项目上跑通"phase 自动 verify" + 解决 apply 失焦 + 接入真集成 smoke。

**对应痛点**：P1 / P2 / P3

**具体工作**（围绕"生成/验证分离"落地，编排平台沿用 Hermes 不更换）：

1. **实现 Property Translator**（skill 形态）：把 CHK 翻译为可执行 property，复用并改造现有 `zsspec-verify`（针对 P2 的规格可执行化）
2. **实现独立 Verifier subagent**：对抗式 system prompt + "输入白名单/输出结构化"契约（见 §4.5A），替代"Writer 自评"（针对 P2）
3. **实现 Tier1 + Tier2 验证**：静态命令（tsc/eslint）+ property 测试（Hypothesis/fast-check，含 shrinking）（针对 P2 / P9）
4. **实现三路决策路由**：验证失败且语义模糊时，分类推送"修代码/修规格/修测试"（针对 P2 / P8）
5. **扩展 handoff pack**：spec 强制 inline + phase 内强制回读 + 要求引用规格段落（针对 P1）
6. **新增 stage 10：真集成 smoke**（起服务 + 真实请求 + 抓日志）（针对 P3）

**成功标准**（可量化）：

- 选定 1 个具体示范项目（建议从现有 4 个 zsspec 项目中选 1 个）
- 该项目跑完 **5 个完整 feature**，全 phase 经"4 级验证阶梯 + 独立 Verifier"
- **property 测试抓到的 bug 数 ≥ 单元测试抓到的**（验证可执行规格的价值）
- **人工介入次数较现状下降 ≥ 50%**（验证"分离 + 三路决策"省精力）
- 每个 phase 转换 ≤ 15 分钟人工介入；一性成功率 ≥ 50%（M1 是基础线，后续提升）
- M1 末提交一份"验证层适用性报告"——含 4 级阶梯命中率、三路决策分布、false positive / false negative 案例

#### 阶段 2（M2，第 2 个月）：解决 P4 / P5 / P6

**目标**：规模化前的最后一公里。

**对应痛点**：P4 / P5 / P6

**具体工作**：

1. 引入可持久化 runtime（M2 评估后选型，按 §4.6.3 评估结果定）：session log + goal state + checkpoint + resume（针对 P4）
2. 实现 Multi-goal Queue：跨项目并行（针对 P5）
3. 接入 OTel + 自告 webhook（针对 P6）
4. 实现远程 pause/resume/rewind 命令

**成功标准**：

- 单人管 **5+ 并行 goal** 不卡顿
- session 崩溃后 30 秒内自动 resume
- 手机端能 pause/resume/rewind
- 一性成功率 ≥ 70%

#### 阶段 3（M3，第 3 个月）：评估 + P7 / P8 / P9 收尾

**目标**：量化收益 + 决策是否规模化。

**对应痛点**：P7 / P8 / P9

**具体工作**：

1. 量化所有 KPI（见 §5.3）：phase 转换耗时、一性成功率、并行项目数
2. 推广到 5–10 个项目验证
3. 与商业产品（Devin）做能力对照（参见 §3.3 能力矩阵）
4. 决策是否全面铺开

**成功标准**：

- 一性成功率 ≥ 70%
- 每个 phase 人工介入 ≤ 15 分钟
- 并行项目数 ≥ 4 个/人
- 每月节省人工 ≥ 400 小时（见 §5.3 ROI 测算）

---

## §5 投入与里程碑

### 5.1 投入估算

| 资源 | 数量 | 备注 |
|---|---|---|
| 架构师 | 1 人 × 3 个月 | 主导方案设计与技术决策 |
| 资深工程师 | 1 人 × 3 个月 | 实现 Property Translator + Verifier subagent + 三路决策 + 编排状态机 |
| 编排平台（增强版 Hermes / 待评估 runtime）| 已有 / 待评估 | 优先复用，M2 评估选型（见 §4.6.3）|
| 试点项目 | 1 个 | 从现有项目中选 |

**总投入**：约 2 人 × 3 个月（不含基础设施）。

### 5.2 三个里程碑

> **每个里程碑都对应 §4.4 痛点映射表中的具体痛点** —— 不是凭空定的，是有驱动的。

| 里程碑 | 时间 | 解决痛点 | 可交付物 | 验证方式 |
|---|---|---|---|---|
| **M1** | 第 1 个月末 | P1 / P2 / P3 | 验证层 v0.1（Property Translator + Verifier subagent）+ 单项目 POC + stage 10 真集成 smoke | 5 个完整 feature 全 phase 自动 verify；phase 转换 ≤ 15 分钟 |
| **M2** | 第 2 个月末 | P4 / P5 / P6 | 可持久化 runtime（M2 评估选型）+ Multi-goal Queue + 远程命令 | 单人管 5+ 并行 goal 不卡顿；崩溃 30 秒内 resume |
| **M3** | 第 3 个月末 | P7 / P8 / P9 | KPI dashboard + 商业产品对照 + 决策建议 | KPI 全部达标 + ROI 数据可读 |

### 5.3 KPI 与收益测算

> **每个 KPI 都对应 §4.4 映射表中的痛点** —— 不是凭空设的，是被痛点驱动的。

| KPI | 痛点来源 | 当前 | M3 目标 | 收益来源 |
|---|---|---|---|---|
| 每个 phase 转换人工介入 | P2 | ~60 分钟 | ≤ 15 分钟 | **节省 75% 验证开销** |
| 一性成功率（CC 跑完无需 rewind） | P9 | ~30% | ≥ 70% | **少 2-3 次迭代/feature** |
| 单人并行项目数 | P5 | 2-3 个 | 4-6 个 | **资源利用率提升 50-100%** |
| 单 feature 平均工期 | P1 / P3 | 3 天 | 2 天 | **研发周期缩短 33%** |
| 真集成 smoke 覆盖率 | P3 | 0% | ≥ 80% | **bug 漏出减少** |
| 跨 session 续跑成功率 | P4 | 需手工 | ≥ 95% | **崩溃不再丢上下文** |

#### 按月累计 ROI（15 人团队估算）

> **说明**：M1-M2 是纯投入期（仅构建），M3 末开始部分产出，M4+ 进入稳态。回本周期比"1.2 个月"更现实。

| 月份 | 投入 | 节省 | 累计净收益 | 备注 |
|---|---|---|---|---|
| **M1** | 10万 | 0 | -10万 | POC 阶段，仅构建，无产出 |
| **M2** | 10万 | 0 | -20万 | M2 仍在构建，**无产出** |
| **M3** | 10万 | ~5万 | -25万 | M3 末部署，部分团队试用 |
| **M4** | 0 | **25万** | **0万** | 稳态产出开始 |
| **M5** | 0 | 25万 | +25万 | **第 5 个月回本** |
| **M6+** | 0 | 25万 | 持续增长 | 规模化收益 |

* M3 月节省按 1/3 算（边评估边产出，团队还在适应）
* M4 起稳态产出 25 万/月，对应 §5.3 计算明细

#### 收益计算明细（统一口径）

- 每个工程师每天在 phase 转换上花约 1.5 小时（P2 + P9 是主要消耗）
- 压缩到 15 分钟 = 每天节省 1.25 小时/人
- 15 人 × 1.25 小时 × 22 工作日 = **每月节省约 412 小时**
- 按综合工程师成本（资深 + 普通加权）**约 600 元/小时**
- **每月节省约 25 万元**（412 × 600 ≈ 25万）

> **说明**：本计算只算 phase 转换节省的工时，没有算 P3（调试 agent 代码）/ P7（需求拉扯）/ P9（评测）等其他痛点带来的额外收益。**因此 25 万/月是保守估算**——实际可能翻倍。

#### 回本周期

- 累计投资：~30 万元（2 人 × 3 个月 + 工具费用）
- 稳态月节省：~25 万元
- **从 M1 起算 ~5 个月回本；从 M3 完成起算 ~2 个月回本**
- 之后规模化收益线性增长

> **我认为**：这个回本周期是**保守估算**。实际收益可能更高——因为：
> 1. 节省的可能不止 phase 转换时间（bug 漏出减少带来的质量杠杆）
> 2. 跨项目并行带来的杠杆（4-6 个并行项目 > 4 个人的 4 倍工作量）
> 3. 知识积累（workspace memory）带来长期复利

---

## §6 风险与回退条件

### 6.1 技术风险

> **每条风险的缓解措施已在 §4 方案中明确** —— 这里给出"风险→方案"的对应关系，避免老板觉得"风险是事后补丁"。

| 风险 | 严重度 | 缓解措施 | 覆盖来源 |
|---|---|---|---|
| **Agent apply 失焦**（不读完整 spec） | 🔴 高 | Spec 强制 inline 到 handoff；phase 内强制回读；要求引用规格段落 | §4.7 M1-P1 |
| **Verify 漏判**（命令通过但实际有 bug） | 🟠 中 | 4 级验证阶梯 + 独立 Verifier 对抗审查 + 三路决策兜底 | §4.5.2 / §4.5.4 |
| **Verifier/Writer 共谋或自评自骗（记忆奖励）** | 🔴 高 | 六道防线：架构隔离 + 客观执行 + 激励对齐 + 最小反例 + 测试完整性扫描 + 三路决策 | §4.5.5 / §4.5A |
| **上下文爆炸**（长 session 失忆） | 🟡 中 | Compaction + 阶段性摘要 + 工作记忆 | §4.5.6 L1（runtime 自带） |
| **Tool 副作用**（agent 误删/误写） | 🔴 高 | Sandbox 隔离 + 写操作审计 | §4.5.6 L1 |
| **Token 成本失控** | 🟡 中 | Per-phase budget cap；超过告警 + 暂停 | §4.5.6 L2 |
| **模型升级破坏兼容** | 🟡 中 | Worker 抽象 + 可插拔；小流量灰度 | §4.6.2 可插拔策略 |

> **诚实声明（成本换可信度）**：本架构用多个独立 subagent（Property Translator / Verifier / Debugger）+ property 测试来换可信度，token 消耗**高于**现在的"单 agent 自评"。这是"用成本换信任"的有意取舍，不是疏忽。缓解：分级触发——低风险阶段只跑 Tier1/2，高风险/收口阶段才上全套；并设 per-phase budget cap（见上表）。省下来的是更贵的人工注意力，账仍划算（见 §5.3）。

### 6.2 组织风险

| 风险 | 严重度 | 缓解措施 | 覆盖来源 |
|---|---|---|---|
| **团队抗拒**（担心被替代） | 🟠 中 | 定位为"放大工程师能力"非"替代"；让最有经验的人先用 | §4.1 核心判断 |
| **责任边界不清**（agent 出的 bug 谁负责） | 🟠 中 | 明确：人定 spec = 人担责；agent 执行 = 不担责；merge = 人批 | §2.2 边界原则 |
| **流程破坏**（与现有 PR review 冲突） | 🟡 中 | 不替换现有 review，只在 review 前自动 verify | §4.1 核心判断 |
| **安全合规**（agent 写错文件泄露密钥） | 🔴 高 | 所有写操作审计；密钥不入 prompt；env 走 sealed secrets | §4.5 L1 |

### 6.3 商业风险

| 风险 | 严重度 | 缓解措施 | 覆盖来源 |
|---|---|---|---|
| **依赖单一 Coding Agent** | 🟡 中 | Worker 抽象可插拔 | §4.6.2 |
| **商业产品降价抢市场** | 🟡 低 | 我们的护城河是自有 codebase 与 spec 体系 | §4.6.1 |
| **模型成本上涨** | 🟡 中 | 可切换国产模型；per-phase budget | §4.6.2 |

### 6.4 回退条件：什么信号出现就停

| 信号 | 处理 |
|---|---|
| 连续 2 周一性成功率无提升 | 暂停优化，回顾 spec 体系本身 |
| 安全事件（agent 写错文件/删库/泄密） | 立即暂停，全员排查 |
| 团队满意度持续下滑（>2 周） | 暂停推广，先解决采纳问题 |
| Token 成本超过预算 2 倍 | 暂停，切国产模型或限流 |
| **M3 评估后 ROI 不达标** | 停止主线，回到现有 zsspec 优化 |

### 6.5 已知的"做不到"——必须诚实承认

* **业务边界判断无法自主**——必须人
* **架构选型责任无法转移**——必须人
* **Merge 决策无法自动**——必须人
* **跨领域重大变更无法自主**——必须人
* **自主不是 100% 替代人工**——是解放 50% 以上注意力（目标 75%），不是 100%

---

## §7 决策请求

### 7.1 请批准（资源类）

| 项 | 内容 | 估算 |
|---|---|---|
| **人力** | 1 名架构师 + 1 名资深工程师，3 个月全职 | ~25万 |
| **预算** | Claude Code / token / 测试费用 | ~5万 |
| **试点项目** | 从现有 4 个 zsspec 项目中选 1 个（建议选当前最痛的） | — |
| **时间窗口** | M1 (1 月) → M2 (2 月) → M3 (3 月) | **3 个月** |

### 7.2 请确认（方向类）

| 项 | 备选 |
|---|---|
| **路线选择** | 见下方 §7.3 路线选择题 |
| **优先级** | 自主编程 OS vs 其他 AI 项目，哪一个先做？ |
| **范围** | 是覆盖 P1-P9 全部 9 个痛点，还是先聚焦 M1 阶段的 P1/P2/P3？ |
| **考核** | 是否将"一性成功率"与"phase 介入时长"纳入团队 OKR？ |

### 7.3 路线选择题

**请选择我们要走的路线**：

| 路线 | 范围 | 时间 | 人力 | 评价 |
|---|---|---|---|---|
| **A（推荐）** | M1→M2→M3 全做 | 3 个月 | 2 人 | **当前主推** |
| **B（保守）** | 只做 M1（验证"生成/验证分离"可行性） | 1 个月 | 1.5 人 | 适合不确定路线价值时 |
| **C（激进）** | 扩大范围（多项目并行 + 自研 runtime） | 6 个月 | 3 人 | 高投入高风险，不推荐 |
| **D（观望）** | 暂缓，等待 Devin 2.0 / OpenHands 进一步成熟 | — | — | 不推荐，会失去先机 |

**我推荐路线 A**，理由：

1. **zsspec 已具备基础**（4 项目验证 + 15 人使用），不需要 0 开始
2. **M1 单独跑通即可证明"生成/验证分离"的价值** —— 即使后续不做，沉淀也有用
3. **30 万投入相对公司 AI 预算可控**
4. **~5 个月回本**（保守），6+ 月开始纯收益
5. **路线 D 等竞争对手会让我们失去先发优势** —— 客户进入"行业基线"判断时我们将付出更高切换成本

### 7.4 下一步行动

| 时间 | 行动 | 责任人 | 交付物 |
|---|---|---|---|
| **W1** | 选定示范项目 + 细化验证层 v0.1 设计（Property Translator + Verifier subagent + 三路决策） | 架构师 | §4.4 M1 范围确认 + 命令清单草案 |
| **W2** | 实现 Tier1/Tier2 验证 + 搭建反馈闭环 | 资深工程师 | 验证层 v0.1 可跑 |
| **W3-W4** | M1 POC 跑通：1 个示范项目端到端自动 verify | 全员 | 5 个 feature 全 phase 自动 verify |
| **M2 启动条件** | M1 验证通过 + 老板批准路线 A | — | — |
| **M3 启动条件** | M2 验证通过 + KPI 初步达标 | — | — |

---

## §8 框架形态：基于 DSH 的完整链路

> 本节回答同事 C 的问题"我们需要一个完整的 Agent 管理或者说 orchestration 层"——以下是基于 DSH 底座的完整链路设计，与 §4-§6 的方案细节对齐。

### 8.1 为什么选 DSH 作为底座

DSH（DeepSeek Harness）是一个开源的"全插件"Cordis-based agent runtime，提供：

| 能力 | DSH 原生包 | zsspec 用途 |
|---|---|---|
| 持久化会话日志 | `core/session` + `session-persistence` | spec / code / state 全可回放 |
| 长生命周期目标 | `goal/goal` + `goal-round-driver` | 跨 session 续跑（一性成功的关键） |
| 子 agent 物理隔离 | `subagent-spawn-in-process` | Writer/Verifier 上下文隔离 |
| 结构化输出契约 | `outputSchema` JSON Schema | Verifier 返回 `{verdict, issues[], route}` |
| 工具守卫管线 | `tools/pre-execute` / `post-execute` | 验证 gate 挂载点 |
| Skill 加载 | `skill/skill` + `skill-filesystem` | zsspec 9 skill 直接挂载，零重写 |
| 沙箱 + 子进程 | `shell/` + `subprocess/` + Landlock | tsc / eslint / pytest 执行环境 |
| 可观测性 | `session-telemetry` OTel | dashboard / 通知 / 远程介入 |
| 协议稳定 | `SESSION_FORMAT_VERSION` 邻接迁移 | spec 状态写进 SessionEventMap 有版本保证 |

> **结论**：DSH 已经实现我们 80% 需要的底座，我们只需写 20% 的桥接层 + 产品层。**zsspec skill 文件零重写**——通过 `dsh-skill-filesystem` 直接挂载到 `ctx.skills`。

### 8.2 完整链路图

```
┌─────────────────────────────────────────────────────────────┐
│ L4 用户入口层（4 种触发模式）                                 │
│   ├─ A. Web GUI（dsh web, 端口 3080）                       │
│   ├─ B. CLI / dsh --profile headless "task"                  │
│   ├─ C. dsh --profile acp（stdin/stdout JSON-RPC）           │
│   └─ D. dsh --profile sdk（JSON-RPC）  + Webhook HTTP POST  │
├─────────────────────────────────────────────────────────────┤
│ L3 Profile + Bundle 装载                                     │
│   └─ dsh-base bundle（LLM/tools/session/sandbox/approval）   │
│      └─ <用户 profile>（zsspec-poc = base + sdd-pipeline）   │
├─────────────────────────────────────────────────────────────┤
│ L2 编排层：Sdd-Pipeline Driver（我们写）                       │
│   ├─ State Machine（9 stage：brain/spec/verify/apply/...）  │
│   ├─ ctx.goals.create / edit / complete / pause              │
│   ├─ goal-round-driver 自动续推                              │
│   └─ 监听 agent/turn-stopping 触发 stage 推进               │
├─────────────────────────────────────────────────────────────┤
│ L1 Worker 执行层（subagent 多 provider）                       │
│   ├─ Writer subagent（@deepseek-ai/dsh-subagent-spawn-in-process）│
│   │    └─ ctx.skills.get('zsspec-apply') → 写代码          │
│   ├─ Verifier subagent（spawn，物理隔离）                    │
│   │    └─ ctx.skills.get('zsspec-verify') → 对抗审查        │
│   └─ Debugger subagent（反例注入）                           │
├─────────────────────────────────────────────────────────────┤
│ L0 验证栈 + 持久化                                            │
│   ├─ Tier1 ctx.shell tsc/eslint                              │
│   ├─ Tier2 ctx.shell Hypothesis/fast-check                   │
│   ├─ Tier3 ctx.shell Playwright                              │
│   ├─ Tier4 Verifier subagent 对抗审查                        │
│   └─ session log JSONL + ctx.sessions.flush + OTel          │
└─────────────────────────────────────────────────────────────┘
```

### 8.3 4 种用户触发模式 + 3 种交互层

#### 4 种触发模式（"用户怎么启动 Agent"）

| 模式 | 命令 | 适用 | 用户投入 |
|---|---|---|---|
| **A. Web 交互** | `pnpm dsh web` | 开发者日常交互 | 高（看着屏幕输入） |
| **B. 一次性任务** | `pnpm dsh --profile headless "实现 X"` | CI/CD、批处理 | 极低（写完走人） |
| **C. ACP 自动化** | `pnpm dsh --profile acp` | IDE 插件、外部 Agent 集成 | 中（IDE 端交互） |
| **D. Webhook 触发** | `POST /api/webhook/github` | GitHub PR、IM 机器人、定时任务 | 零（被动响应） |

每种触发最终落到一个 `ctx.goals.create({objective, maxGoalRounds: 256})`。

#### 3 种交互层（"Agent 怎么找人"）

| 交互类型 | 何时触发 | DSH API |
|---|---|---|
| **三路决策**（修代码/规格/测试） | Verifier 判 AMBIGUOUS | `ctx.tool-ask-user` |
| **一次性审批** | subagent 准备做敏感操作 | `ctx.user-approval` |
| **Slash 命令**（pause/resume/rewind） | 用户想中断当前 goal | `ctx.commands.register({name: 'goal'})` |

### 8.4 DSH 子 agent 物理隔离：防"自评自骗"

Writer 和 Verifier 都用 `ctx.subagents.start('spawn', ...)`，但参数不同：

```typescript
// Writer subagent：可以读写，有工具全权
ctx.subagents.start('spawn', {
  prompt: [skillBody, specContent].join('\n\n'),
  outputSchema: { /* 写代码结果 */ },
  agentOptions: { model: 'deepseek-chat' },
})

// Verifier subagent：物理隔离 + 只读 + 不同模型
ctx.subagents.start('spawn', {
  prompt: [
    verifierPersona,  // 对抗式 prompt：专职找问题，不是放行
    specContent,
    diffContent,
    testOutputs,
  ].join('\n\n'),
  outputSchema: {
    verdict: ['PASS', 'FAIL', 'AMBIGUOUS'],
    issues: [{ spec_ref: 'string', problem: 'string', evidence: 'string' }],
    route: ['fix_code', 'fix_spec', 'fix_test'],
  },
  agentOptions: { model: 'deepseek-reasoner' },  // 不同模型，避免同源放水
  toolFilter: { mode: 'allow', tools: ['read', 'shell'] },  // 只读
})
```

> **关键保证**：spawn provider 给全新 flat scope，Verifier 看不到 Writer 的"我觉得我做好了"——**隔离靠架构不靠 prompt**。这是 §4.5 6 道防线的第 1 道防线，DSH 原生保证。

### 8.5 完整 14 环节自主化评估（基于 DSH 能力）

| # | 环节 | DSH 实现 | 自主等级 |
|---|---|---|---|
| 1 | 需求澄清 | `ctx.skills.get('zsspec-brain')` + goal round | 🟡 半自主 |
| 2 | 架构设计 | `ctx.skills.get('zsspec-spec')` | 🟡 半自主 |
| 3 | 任务分解 | subagent 派发 Spec Writer | 🟢 高自主 |
| 4 | CHK 生成 | `ctx.skills.get('zsspec-test-gen')` | 🟢 高自主 |
| 5 | spec 一致性 | Verifier subagent | 🟢 全自主 |
| 6 | 代码实现 | Writer subagent + apply skill | 🟢 高自主 |
| 7 | 单元测试 | `ctx.shell` 跑 tsc/pytest | 🟢 全自主 |
| 8 | 静态审查 | `ctx.skills.get('zsspec-code-review')` | 🟢 全自主 |
| 9 | e2e 生成 | `ctx.skills.get('zsspec-e2e-gen')` | 🟢 高自主 |
| 10 | 集成 smoke | `ctx.shell` + 真服务起停 | 🟢 全自主 |
| 11 | PR 创建 | `ctx.shell` 执行 git + GitHub API | 🟢 全自主 |
| 12 | CI 反馈 | `dsh-webhook-github` 接收 CI 状态 | 🟢 全自主 |
| 13 | PR Review | Verifier subagent 复审 | 🟡 半自主 |
| 14 | Merge | 不建议全自主 | 🟠 慎自主 |

**结论**：DSH 已经支持 14 环节中 13 个的完全自主化。

### 8.6 关键 POC 落地路径（6-8 周）

> 详细技术设计见 `non-functional/autonomous-programming-tech-design.md`，这里只列周计划。

| 周 | 目标 | 关键动作 | 验收 |
|---|---|---|---|
| **W1-2** | 跑通单 stage | `dsh --from-default-profile headless --profile zsspec-poc` + skill-filesystem 挂载 | 1 个 feature 跑通 |
| **W3-4** | 加独立 Verifier | 实现 packages/sdd-pipeline/driver.ts，spawn Writer + Verifier | Verifier 抓到 1 个 LLM 自评漏掉的 bug |
| **W5-6** | 加 webhook 触发 | 装载 dsh-webhook + dsh-webhook-github，写 1 个 PR rule | 开 PR → DSH 自动跑 |
| **W7-8** | 完整 9 stage + dashboard | 装载 dsh-web，3 个完整 feature 跑通 | 一性成功率 ≥ 50% |

#### 立即可执行（无需团队决策）

```bash
# 1. 创建 zsspec-poc profile（基于 headless）
pnpm dsh --from-default-profile headless --profile zsspec-poc

# 2. 编辑 ~/.dsh/profiles/zsspec-poc/cordis.patch.yml：
#    - 挂载 skill-filesystem 指向 ~/.claude/skills
#    - 挂载 subagent + tool-subagent
#    - 挂载 goal + goal-round-driver + tool-goal

# 3. 用 build 后的 binary 跑（避开源码 + tsx 的 absolute path bug）
pnpm run build
node apps/cli/lib/bin.js --profile zsspec-poc "为 demo 项目实现用户导出 CSV"
```

> **注意**：必须用 built binary 跑，源码 + tsx 路径有 absolute path bug（详见 `vendor/loader/src/config/tree.ts:144-162` 的 import() 分支判断）。

### 8.7 我对框架形态的最终判断

| 维度 | 结论 |
|---|---|
| **底座** | DSH 已选（goal / subagent / workflow / webhook / skill 全部原生） |
| **我们写的层** | packages/sdd-pipeline/driver.ts（约 200 行）+ packages/sdd-pipeline/stages/*.ts（9 个 stage worker） |
| **不写的层** | subagent runtime、session log、subagent isolation、tool system、web server、event system |
| **可以马上验证** | W1-2（一个 profile + 一个 skill 挂载 + 一个 feature）——1 天能跑通 |
| **诚实声明** | DSH API pre-stable；但 goal/workflow/subagent/skill 已是稳定 API，可放心使用 |

---

## 附录 A：14 环节评估者矩阵（详细）

| 环节 | 一级评估者 | 二级评估者 | 兜底 | 数据来源 |
|---|---|---|---|---|
| 1 需求澄清 | LLM judge | 反问覆盖度 | 人 | brain 结论 |
| 2 架构设计 | LLM judge | 设计约束清单 | 人 | DES 文档 |
| 3 任务分解 | 规则引擎 | 完整性检查 | 人 | TASK 表 |
| 4 验收清单 | 规则引擎 | 编号追溯 | 人 | CHK 表 |
| 5 spec 一致性 | 规则引擎 | LLM judge | 人（仅阻塞） | verify 报告 |
| 6 代码实现 | tsc/test exit | lint 静态 | LLM judge | git diff |
| 7 单元测试 | pytest exit | 覆盖率 | LLM judge | coverage report |
| 8 静态审查 | eslint/tsc | LLM judge（命名/风格） | 人（critical） | lint report |
| 9 e2e 生成 | LLM judge | 可运行性 | 人 | playwright 代码 |
| 10 真集成 smoke | curl exit + 日志 | LLM judge（响应 shape） | 人（仅异常） | smoke 报告 |
| 11 PR 创建 | GitHub API | LLM judge（描述） | 人 | PR URL |
| 12 CI 反馈 | GitHub API exit | LLM judge（CI 报告） | 人（仅红） | CI 状态 |
| 13 Code Review | 规则 + LLM | 人 | — | review 报告 |
| 14 Merge | 人 | — | — | merge commit |

## 附录 B：术语表

| 术语 | 定义 |
|---|---|
| **SDD** | Spec-Driven Development，规格驱动开发 |
| **zsspec** | 我们的 SDD skill 套件，9 个子 skill 覆盖完整研发流程 |
| **Phase** | SDD 的一个阶段（brain / spec / verify / apply 等） |
| **Goal** | 一次端到端的研发任务（一个模块从 0 到 done） |
| **HITL** | Human-in-the-Loop，人在回路 |
| **ACI** | Agent-Computer Interface，agent 与工具的接口 |
| **Verifier** | 独立对抗式验证 agent（subagent 形态）：LLM 主导，命令提供客观证据；与 Writer 上下文隔离，专职找问题 |
| **Writer** | 生成者（如 Code Writer），产出代码/文档；与 Verifier 分离，不自证 |
| **生成/验证分离** | 本方案第一性原理：生成者与验证者架构隔离，防记忆奖励与自评自骗 |
| **可执行规格（Executable Spec）** | 把 CHK 验收项翻译成机器可跑的 property，作为客观 ground truth |
| **Property Translator** | 把规格翻译为可执行 property 的角色（skill 形态） |
| **属性测试（PBT）** | Property-Based Testing，用随机生成的大量输入验证 property，失败给反例 |
| **Shrinking** | PBT 失败时把反例自动压缩成最小可复现例子，便于定位 |
| **对抗式审查** | Verifier 以"找问题"为激励、对照规格挑毛病的验证方式 |
| **三路决策** | 验证失败且语义模糊时，路由人做"修代码/修规格/修测试"三选一 |
| **4 级验证阶梯** | 静态 → property → 行为 → 对抗审查，按"便宜→贵"逐级拦截 |
| **Reward Hacking** | agent 通过钻空子骗过验证（如注释掉测试用例） |
| **Orchestrator** | 协调层，确定性状态机，管理 goal 流转/重试/升级，不做语义判断 |
| **Sub-agent** | 子 agent，独立的 context 跑独立任务 |
| **Worker** | 执行层 agent，跑具体 stage 任务 |
| **L0–L5** | 自主等级光谱（见 §3.2） |
| **DeepWiki** | Cognition 的知识图谱系统，索引 codebase |
| **Checkpoint** | 状态快照，可恢复 |
| **Fork** | 从已有 session 创建子 session |

## 附录 C：参考文献

- Devin AI Technical Architecture - https://www.zenml.io/llmops-database/building-an-autonomous-ai-software-engineer-with-advanced-codebase-understanding-and-specialized-model-training-6bnir
- Devin AI Review 2026 - https://techvernia.com/pages/reviews/coding/devin.html
- SWE-agent (Princeton) - https://swe-agent.com/latest/background/
- OpenHands Architecture - https://deepwiki.com/All-Hands-AI/OpenHands/3-system-architecture
- AgentOS HITL Design - https://docs.agentos.sh/features/human-in-the-loop
- Cursor Self-Improving Agent Factory - https://www.zenml.io/llmops-database/building-a-self-improving-ai-coding-agent-factory
- AutoCodeRover / SWE-bench Leaderboard - https://www.swebench.com
- DeepSeek Harness - https://github.com/deepseek-ai/deepseek-harness（本项目，基于 Cordis 的 agent runtime）

## 附录 D：变更记录

| 版本 | 日期 | 作者 | 说明 |
|---|---|---|---|
| v0.1 | 2026-09-03 | myq | 初稿，内部研讨 |
| v0.2 | 2026-09-04 | myq | 修订稿，内部研讨 |

---