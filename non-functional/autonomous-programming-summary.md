# 自主编程 OS 立项简报

> **版本**：v1.0 简洁版（基于详细版 `autonomous-programming-report.md` 提炼）
> **读者**：决策者 + 一线工程师
> **一句话**：把"AI 写代码"从"盯着看"变成"自动跑、人只做选择题"。

---

## 0. 用户与需求：这套系统到底解决谁的什么问题

> 这一节是后续所有方案设计的根——任何"做什么"必须先回答"为谁做、要什么"。

### 0.1 四类目标用户

| 用户 | 在团队中的角色 | 每天/每周做什么 | 对 AI 工具的核心诉求 |
|---|---|---|---|
| **其源** | 一线工程师 | 接到任务 → 写代码 → 调通 CI → 提 PR | "我下次打开电脑，spec 已经收敛好、代码已经跑通测试，我只看最后的 PR" |
| **曲铭** | 一线工程师 | 同上 + 偶尔负责 e2e 验证 | "我写完一句话，下面要自己跑通、自己验完、自己合并可商量的部分" |
| **牛总**（CTO / 工程总监） | 团队 Lead | 决定技术方向、分配项目、关注 ROI | "我能用一个 dashboard 看 5 个项目在干什么、卡在哪、需要我决策什么" |
| **决策者**（CTO / 工程总监） | 资源审批人 | 决定投不投、投多少 | "花 30 万 / 3 月能换什么？会不会把团队带偏或被锁死？" |

### 0.2 用户具体需求（按用户分群拆解）

#### 其源：每个 task 想少 1 小时

| 需求 | 当前满足方式 | 期望满足方式 |
|---|---|---|
| **需求澄清别反复拉扯** | 和产品来回会议、自己逐字改 AI 稿 | AI 一次性反问 ≤ 2 个关键点，我答完就出最终 spec |
| **spec 转 4 份文档别漏** | 自己读 4 份找遗漏 | REQ↔CHK 双向追溯工具，机器告诉我"这条 REQ 没对应检查项" |
| **apply 别漏 spec** | 自己盯着 agent 写 | spec 强制 inline 到 agent prompt，agent 不读全不能写 |
| **验收别只看 mock** | 自己起服务 curl | 集成 TDD smoke 自动跑，PASS 才算 done |

#### 曲铭：每个 feature 想省半天

| 需求 | 当前满足方式 | 期望满足方式 |
|---|---|---|
| **一次成型率提升** | 改了再让 agent 改 | Verifier 子 agent 独立审查，3 次不过才升级人 |
| **不漏功能** | 自己 grep 编号 | spec 覆盖率 ≥ 95% 才进 verify |
| **不漏验收环节** | 自己列表 | 4 级验证阶梯自动跑（tsc/PBT/smoke/Verifier） |
| **真集成要稳** | 自己测 | 真服务 smoke 自动起停 + 抓日志 |

#### 牛总：每个 sprint 想管 4-6 个项目

| 需求 | 当前满足方式 | 期望满足方式 |
|---|---|---|
| **看全团队进度** | 问每个人 | dashboard 实时显示 N 个 goal 状态、卡在哪 |
| **远程介入** | 找人 ping | 手机/IM 触发 pause/resume/rewind |
| **判断价值** | 自己估 | 一性成功率 + phase 介入时长量化 |
| **不被锁死** | 看代码 | Worker 抽象可插拔，可切国产模型 |

#### 决策者：每个季度想看见 ROI

| 需求 | 当前满足方式 | 期望满足方式 |
|---|---|---|
| **投入回报清楚** | 拍脑袋 | 量化：M1 验证假设 / M3 评估 KPI / 月节省 25 万 |
| **风险可控** | 拍胸脯 | 5 条回退条件 + 阶段独立可验收 |
| **不会替代人** | 听 HR 抱怨 | 诚实声明：业务边界/架构/Merge 必须人，自主=解放 50%+ 注意力 |
| **不锁单一供应商** | 怕 | Worker 抽象 + runtime abstraction layer |

### 0.3 需求 → 设计点的映射（确认本方案是否覆盖）

| 用户需求 | 设计点 | 是否覆盖 | 备注 |
|---|---|:---:|---|
| 其源：spec 别漏 | REQ↔CHK 双向追溯（grep + 解析器） | ✅ | W1-2 POC 跑 |
| 其源：AI 一次性反问 | brain skill + 结构化反问树 ≤ 2 个 | ✅ | W3-4 |
| 其源：spec 强制到 apply | zsspec-apply 模板升级 + handoff pack | ✅ | W1-2 |
| 其源：mock ≠ 真集成 | stage 10 集成 smoke TDD | ✅ | W3-4 |
| 曲铭：一次成型 | Writer/Verifier 物理隔离 + outputSchema 契约 | ✅ | W3-4 |
| 曲铭：不漏功能 | spec 覆盖率 ≥ 95% 门禁 | ✅ | W3-4 |
| 曲铭：4 级验证 | tsc/PBT/smoke/Verifier 自动跑 | ✅ | W3-4 |
| 曲铭：真集成稳 | 集成 smoke 自动起停服务 | ✅ | W3-4 |
| 牛总：dashboard | dsh-web（Web GUI）+ agent/* 事件订阅 | ✅ | W7-8 |
| 牛总：远程 pause/resume | dsh-webhook + dsh-web（手机 PWA） | ✅ | W5-8 |
| 牛总：量化价值 | KPI dashboard（一性成功率 + phase 介入时长） | ✅ | W7-8 |
| 牛总：可插拔 | Worker 抽象 + runtime abstraction layer | ✅ | M2+ |
| 决策者：ROI 清楚 | 详细版 §5.3 月节省 25 万 / M5 回本 | ✅ | 本立项 |
| 决策者：风险可控 | 5 条回退条件（详细版 §6.4） | ✅ | 本立项 |
| 决策者：不锁单 | 自身需求"Worker 抽象" + "诚实声明" | ✅ | 本立项 |

**结论**：15 项用户需求 → 15 项设计点 全部覆盖。

### 0.4 谁的需求本方案不满足（诚实说明）

| 用户类型 | 不被满足的需求 | 原因 |
|---|---|---|
| **PM / 业务方** | "AI 帮我把模糊业务想法转成可开发 spec" | 业务边界判断必须人（§6）；但 zsspec-brain skill 能辅助反问 |
| **设计岗** | "AI 帮我出高保真原型图" | DSH 暂无 UI 生成能力（不在本方案 scope） |
| **HR / 运营** | "AI 帮我自动绩效考核" | 完全不在本方案范畴 |

> **我们的目标用户** = 研发团队（后端 + 全栈 + 架构 + 工程决策者）。**不是产品团队、不是设计团队、不是运营团队**——这是有意识收敛。

---

## 1. 痛点：为什么必须做

### 1.1 一线同事的真实反馈（2026-09 沟通采集）

| 角色 | 痛点原话 | 频率 |
|---|---|---|
| **其源** | "和 AI 来回澄清 spec 要 2 小时，它不确定也不反问，写完我自己还得逐字改" | 每次任务 |
| **曲铭** | "AI 一次成型率很低，spec 写了但代码没实现；mock 测试通过但真集成就 502" | 每次实现 |
| **牛总** | "我们没有完整的 Agent 管理 / orchestration 层，多个 AI 工具碎片化，没人统一调度" | 团队级 |

### 1.2 结构性根因（痛点的机制层）

| 编号 | 痛点 | 现状 | 目标 | 对应 §0 用户 |
|---|---|---|---|---|
| P1 | apply 失焦（agent 不读完整 spec） | 高发 | 几乎消除 | 其源 + 曲铭 |
| P2 | verify 扯皮（LLM 自评不可信） | 高发 | 几乎消除 | 其源 + 曲铭 |
| P3 | 调试 agent 代码耗精力 | 主力消耗 | 节省 50%+ | 曲铭 |
| P4 | 跨 session 续跑不流畅 | 每次手动 | 自动 resume | 牛总 |
| P5 | 并行项目卡在 2-3 个 | 资源浪费 | 4-6 个 | 牛总 |
| P6 | 需求拉扯 | 2 小时/次 | ≤15 分钟 | 其源 |
| P7 | 一性成功率低 | ~30% | ≥70% | 曲铭 + 牛总 |

### 1.3 团队规模下的问题量级

- 15 人 × 每阶段 1 小时 × 每天多次阶段转换 ≈ **每天数小时被机械判断消耗**
- 团队注意力是最稀缺资源；竞争对手（Devin / OpenHands）已上线
- **不做 = 持续低 ROI + 团队碎片化 + 失去先发优势**

---

## 2. 为什么做：价值与定位

### 2.1 价值锚点（量化）

| 维度 | 现状 | 目标 | 受益用户 |
|---|---|---|---|
| 每阶段人工介入 | ~60 分钟 | ≤ 15 分钟 | 其源 + 曲铭 |
| 一性成功率 | ~30% | ≥ 70% | 曲铭 |
| 单人并行项目数 | 2-3 个 | 4-6 个 | 牛总 |
| 单 feature 平均工期 | 3 天 | 2 天 | 其源 + 曲铭 |

### 2.2 差异化定位（vs 商业产品）

我们和 Devin 等商业产品的核心差异**不是技术，是 codebase 知识的深度**：

- Devin 用 DeepWiki（外部构建）
- 我们是 **zsspec + 内部 codebase 原生集成**（同一批人维护）
- 这是商业产品短期内追不上的护城河

### 2.3 第一性原理

> **自主编程的瓶颈不是"生成代码"，而是"可信地验证代码"。**

当前所有 agentic 编程工具的共同反模式：同一个 agent 既写代码又自我判断——这必然导致"记忆奖励、自我认可、必须有人盯着"。

**对策**：在架构上把"生成者（Writer）"与"验证者（Verifier）"彻底分离，用可执行 spec + 验证清单作为客观门禁。

---

## 3. 技术路线：5 个取舍与 8 周 POC

### 3.1 4 个放弃 + 4 件要做

| 不做（4 个） | 做（4 件） | 服务用户 |
|---|---|---|
| 不自研 agent runtime | 第一件：verify 阶段自动化（ROI 最高） | 其源 + 曲铭 |
| 不绑定单一 Coding Agent | 第二件：apply 阶段 spec 强制读取 | 其源 + 曲铭 |
| 不一上来做多项目并行 | 第三件：新增集成 smoke test TDD（Devin 复盘的分水岭） | 其源 + 曲铭 |
| 不替换现有 PR review / merge 流程 | 第四件：多 goal 并行 + 远程介入（M3） | 牛总 |

### 3.2 6-8 周 POC 路径

| 周 | 目标 | 关键动作 | 验收 | 受益用户 |
|---|---|---|---|---|
| **W1-2** | 跑通单 stage | 基于 headless 创建 zsspec-poc profile，挂载 9 个 zsspec skill | 1 个 feature 跑通 | 其源 |
| **W3-4** | 加独立 Verifier | 实现 packages/sdd-pipeline/driver.ts（spawn Writer + Verifier） | Verifier 抓到 1 个 LLM 自评漏掉的 bug | 曲铭 |
| **W5-6** | 加 webhook 触发 | 装载 dsh-webhook + dsh-webhook-github | 开 PR → DSH 自动跑 | 牛总 |
| **W7-8** | 完整 9 stage + dashboard | 装载 dsh-web，3 个完整 feature | 一性成功率 ≥ 50% | 牛总 |

**回退红线**：W1-2 跑不通 → 假设"分离式 Verifier"证伪 → 回退现有 zsspec 优化，不切换 runtime。

---

## 4. Agent OS 系统：DSH 上的完整链路

### 4.1 是什么

**Agent OS** = 让所有 AI 服务有"统一入口 + 调度 + 验证 + 通知"的系统。它不是产品，是"AI 员工管理系统"。

| 用户 | Agent OS 怎么满足 |
|---|---|
| 其源 | 一个 profile 跑自己提到的事，不是自己 |
| 牛总 | 一个 dashboard 看 N 个 Agent 在干什么、卡在哪 |

### 4.2 选型结论

底座选 **DSH（DeepSeek Harness）**——开源、Cordis 内核、already 实现：

- 持久化会话日志 + 跨 session 续跑（goal/subagent）
- 子 agent 物理隔离（spawn-in-process）
- 结构化输出契约（outputSchema JSON Schema）
- 工具守卫管线（tools/post-execute waterfall）
- Skill 加载（filesystem provider 直接挂载 zsspec）
- 沙箱 + 子进程（Landlock / Seatbelt / bwrap）
- OTel 可观测性 + webhook 通知

**zsspec 9 个 skill 零重写**——通过 filesystem provider 直接挂载到 `ctx.skills`。

### 4.3 完整链路（4 层栈）

```
┌────────────────────────────────────────────┐
│ L4 用户入口（4 种触发模式）                  │
│   Web GUI / headless CLI / ACP / Webhook   │
├────────────────────────────────────────────┤
│ L3 Profile + Bundle                         │
│   dsh-base + zsspec-poc（用户配置）          │
├────────────────────────────────────────────┤
│ L2 编排层：Sdd-Pipeline Driver（我们写）      │
│   State Machine + ctx.goals + round-driver  │
├────────────────────────────────────────────┤
│ L1 Worker 执行层（subagent 多 provider）     │
│   Writer subagent / Verifier subagent /      │
│   Debugger subagent                          │
├────────────────────────────────────────────┤
│ L0 验证栈 + 持久化                           │
│   tsc/eslint/PBT/Playwright + session log   │
└────────────────────────────────────────────┘
```

### 4.4 立即可执行（无需决策，1 天能跑）

```bash
# 1. 创建 zsspec-poc profile
pnpm dsh --from-default-profile headless --profile zsspec-poc

# 2. 编辑 ~/.dsh/profiles/zsspec-poc/cordis.patch.yml：
#    - 挂载 skill-filesystem 指向 ~/.claude/skills
#    - 挂载 subagent + tool-subagent
#    - 挂载 goal + goal-round-driver + tool-goal

# 3. 用 built binary 跑（避开源码 + tsx 的 absolute path bug）
pnpm run build
node apps/cli/lib/bin.js --profile zsspec-poc "实现 X"
```

---

## 5. AI 自主干活：4 级验证 + 物理隔离

### 5.1 14 环节自主化评估（DSH 能力下）

| 环节 | 自主等级 | 谁负责 | 谁受益 |
|---|---|---|---|
| 1 需求澄清 | 🟡 半自主 | LLM + 人兜底 | 其源 |
| 2 架构设计 | 🟡 半自主 | LLM + 人兜底 | 其源 + 牛总 |
| 3 任务分解 | 🟢 高自主 | Agent | 曲铭 |
| 4 CHK 生成 | 🟢 高自主 | Agent | 曲铭 |
| 5 spec 一致性 | 🟢 **全自主** | 独立 Verifier | 曲铭 |
| 6 代码实现 | 🟢 高自主 | Agent | 其源 + 曲铭 |
| 7 单元测试 | 🟢 **全自主** | 命令（tsc/pytest） | 曲铭 |
| 8 静态审查 | 🟢 **全自主** | Agent + 命令 | 曲铭 |
| 9 e2e 生成 | 🟢 高自主 | Agent | 曲铭 |
| 10 集成 smoke | 🟢 **全自主** | 命令 + 真服务 | 曲铭 |
| 11 PR 创建 | 🟢 **全自主** | GitHub API | 其源 |
| 12 CI 反馈 | 🟢 **全自主** | GitHub API | 牛总 |
| 13 PR Review | 🟡 半自主 | Agent + 人 | 牛总 |
| 14 Merge | 🟠 慎自主 | **人** | 牛总 |

**结论**：14 环节中 13 个可全自主；Merge 仍由人拍板。

### 5.2 "AI 自主干活、人不参与"是怎么做到的

**4 级验证阶梯**（便宜→贵，多数 bug 在低级别秒级拦截）：

| Tier | 内容 | 谁 |
|---|---|---|
| Tier1 静态 | tsc / eslint / mypy | 命令 |
| Tier2 Property | LLM 写 property，机器跑 100+ 随机输入 + shrinking | LLM 写 + 命令跑 |
| Tier3 行为 | 真集成 smoke + Playwright | 命令 |
| Tier4 对抗 | 独立 Verifier 对照 spec 审查 | 独立 LLM |

**Writer/Verifier 物理隔离**（DSH 原生保证）：

```typescript
// Writer：可以读写
ctx.subagents.start('spawn', {
  prompt: [skillBody, spec].join('\n'),
  agentOptions: { model: 'deepseek-chat' },
})

// Verifier：物理隔离 + 只读 + 不同模型
ctx.subagents.start('spawn', {
  prompt: [verifierPersona, spec, diff, testOutputs].join('\n'),
  outputSchema: { verdict, issues[], route },
  agentOptions: { model: 'deepseek-reasoner' },  // 不同模型防同源放水
  toolFilter: { mode: 'allow', tools: ['read', 'shell'] },
})
```

**人的角色从"监工"变成"裁判"**：

| 触发 | 谁做 | 做什么 |
|---|---|---|
| 验证通过 | — | 无 |
| 验证失败且明确 | Agent | rewind 重试 |
| 验证失败且模糊 | 其源 / 曲铭 | 三路决策：修代码 / 修规格 / 修测试 |

人在回路的 5 种 trigger（其他全自动）：
1. 同阶段连续 3 次失败
2. 同模块 2 次回退到 brain
3. 架构偏离 hard constraints
4. 引入系统级新依赖
5. Merge / 部署（牛总）

---

## 6. 当前阶段做不到的事

- 业务边界判断 / 架构选型 / Merge 决策 **必须人**
- 自主不是 100% 替代人工——是解放 50%+ 注意力（目标 75%），不是 100%
- M1 假设"分离式 Verifier"若证伪 → 回退 zsspec 优化，不切换 runtime

---