# Layer 1 意图识别规则

> Layer 1 Agent 在每次新任务开始时跑 1 次,根据用户输入 + 项目画像,产出 route-plan.yaml。
> 本文件是 Layer 1 决策的"硬规则"。

---

## 1. 输入

- **用户原始需求**(自然语言,可能模糊)
- **项目画像** `.meta-dev/project-profile.yaml`
- **历史状态** `.meta-dev/state.yaml`(如存在)
- **route-plan 模板** `templates/route-plan.template.yaml`

## 2. 输出

- **route-plan.yaml** 落到 `.meta-dev/route-plan.yaml`
- **clarifications_needed** 列表(如有,推用户回答)

## 3. 任务类型识别

### 3.1 关键词分类法

| 关键词 | 任务类型 |
|---|---|
| "做""新建""创建""加个" | T1(新建) |
| "做""加""新功能" + 涉及"复现""翻译""移植""从 json" | T6(翻译/移植) |
| "改""修改""调整""修一下""优化" | T2(变更) |
| "bug""有问题""报错""修 bug" | T2(变更) |
| "重构""重写""重新设计" | T3(重构) |
| "review""验证""检查""看下""审一下" | T4(验证/Review) |
| "重跑""再跑一次""重新做" + stage 名 | T5(重跑 stage) |

### 3.2 上下文辅助分类

- 上一会话里跑过 verify,现在说"继续" → 续跑上次的路由
- state.yaml 里有模块 status=blocked → 用户可能想"修""继续"
- state.yaml 里有模块 status=done → 用户可能想"review"

### 3.3 模糊情况处理

**如果关键词不足以下定论**:
- 默认按 T1 处理(新建模块,跑全流程)
- 在 route-plan 里生成 `clarifications_needed`,推用户确认
- 用户确认后,route-plan 更新,进 Layer 2

---

## 4. 路由图生成

### 4.1 T1(新建模块)默认路由

```yaml
stages:
  - {name: brain, required: true}
  - {name: spec, required: true}
  - {name: test-gen, required: true}
  - {name: verify, required: true}
  - {name: apply, required: true}
  - {name: code-review, required: true}
  - {name: e2e-gen, required: true}
  - {name: e2e-run, required: true}
  - {name: done, required: true}
```

### 4.2 T2(变更 / Bug)默认路由

```yaml
stages:
  - {name: change, required: true}
  - {name: apply, required: true, reason: "实施变更/Bug 修复"}
  - {name: code-review, required: false, reason: "视变更范围决定"}
  - {name: e2e-run, required: false, reason: "仅在变更影响 auto 项时跑"}
  - {name: done, required: true}
```

**Layer 2 决策点**:
- change 判"文档纠错" → 跳过 apply,直接 done
- change 判"重大变更" → 升级用户(问是否回退 brain)
- change 判"Bug 修复(大影响)" → 跑 spec 修订 + apply + code-review

### 4.3 T3(重构)默认路由

```yaml
stages:
  - {name: brain, required: true, reason: "重构需要重新理解需求"}
  - {name: spec, required: true, reason: "重构需要更新 spec"}
  - {name: apply, required: true}
  - {name: code-review, required: true}
  - {name: e2e-gen, required: false, reason: "视重构范围决定"}
  - {name: e2e-run, required: false, reason: "视重构范围决定"}
  - {name: done, required: true}
```

### 4.4 T4(验证 / Review)默认路由

```yaml
stages:
  - {name: code-review, required: true}
  - {name: done, required: true}
```

**变体**:
- "verify 一下" → 路由 = `[verify, done]`
- "review + e2e" → 路由 = `[code-review, e2e-run, done]`

### 4.5 T5(重跑 stage)默认路由

```yaml
stages:
  - {name: <用户指定的 stage>, required: true}
  - {name: done, required: true, reason: "记录重跑结果"}
```

### 4.6 T6(翻译 / 移植)默认路由

```yaml
stages:
  - {name: brain, required: true, reason: "理解源数据(例:json)的语义"}
  - {name: spec, required: true, reason: "定义目标实现"}
  - {name: apply, required: true, reason: "实施翻译/移植"}
  - {name: code-review, required: true}
  - {name: e2e-gen, required: false, reason: "源数据有验收标准时跑"}
  - {name: e2e-run, required: false, reason: "源数据有验收标准时跑"}
  - {name: done, required: true}
```

---

## 5. clarifications_needed 生成

**何时生成**:
- 任务类型不明确
- 模块名冲突(已有同名模块)
- 项目缺关键依赖(如无 hard_constraints_doc)
- 用户输入完全模糊(只有"做一下"几个字)
- 多个可能路由(用户说"做 X"但 X 可能是新建也可能是改)

**生成格式**:
```yaml
clarifications_needed:
  - question: "<具体问题>"
    options:
      - "<选项 1>"
      - "<选项 2>"
    default: "<默认>"
  - question: "<问题 2>"
    type: open  # 开放问题
```

**处理流程**:
1. Layer 1 产出 route-plan,clarifications_needed 非空
2. 推飞书 / 日志:"任务开始前需要澄清 X 个问题"
3. 等用户回答
4. 用户回答后,更新 route-plan,进 Layer 2

---

## 6. 风险评估

每个路由图必含 `risks` 列表,Layer 1 评估以下风险:

| 风险 | 评估依据 |
|---|---|
| 业务复杂度高 | 模块涉及多端 / 多人协作 / 跨服务 |
| spec 体系缺失或不规范 | spec_system.type=none 或 has_template=false |
| 缺少测试基础设施 | test_system.e2e_runner=none |
| 架构不明确 | architecture_doc 不存在或简略 |
| 任务涉及敏感操作 | 涉及生产数据 / 鉴权 / 资金 |
| CC 容易失败的点 | 从 state.yaml 历史 issues 调 |

---

## 7. estimated_total_minutes 计算

**默认估算**(分钟):

| stage | 估算 |
|---|---|
| brain | 10 |
| spec | 20 |
| test-gen | 10 |
| verify | 5 |
| change | 5 |
| apply | 60 |
| code-review | 10 |
| e2e-gen | 15 |
| e2e-run | 10 |
| done | 5 |

**调整因子**:
- 项目复杂度高(代码量大)→ apply ×1.5
- 任务涉及多端 → spec ×1.3, apply ×1.3
- 任务跨多个服务 → apply ×1.5
- 任务有现成模板 → spec ×0.7

---

## 8. Layer 1 的边界

**Layer 1 做**:
- 读用户输入 + 项目画像
- 分类任务类型
- 生成 route-plan.yaml
- 生成 clarifications_needed
- 评估风险

**Layer 1 不做**:
- 派 CC 执行 stage
- 写 spec 文档
- 写代码
- 跑测试
- 决策 stage 之间的路由(那是 Layer 2 的事)
- 决策 rewind(那是 Layer 2 的事)
- 决策升级用户(那是 Layer 2 的事)

**Layer 1 失败处理**:
- 项目画像缺失 → 派 CC 扫描项目,生成画像
- 任务完全无法理解(空字符串) → 推用户"请重新描述任务"
- 项目缺 hard_constraints_doc → 派 CC 找项目根目录的 README / ARCHITECTURE.md,或升级用户"请提供项目硬约束文档"

---

## 9. 跑 Layer 1 的方式

**实际执行**:
- Layer 1 是**主对话里的我**(不派 CC)
- 因为需要"看完整上下文"(你给的所有历史)
- 派 CC 看不到完整对话,做不了意图识别

**CC 不做意图识别**,但可以做辅助:
- 扫项目生成 profile(CC 做)
- 找项目的硬约束文档(CC 做)
- 跑 stage(CC 做)

**这是 zs-dev-orchestrator 的核心创新**:
- Layer 1(意图识别) = 我(主对话的我)
- Layer 2(编排决策) = 我
- Layer 3(执行) = CC

---

## 10. 用户可手工修订 route-plan

**route-plan.yaml 是给人读的、可改的**:
- 你可以编辑 stages 列表(删掉/添加 stage)
- 你可以改 parameters
- 你可以改 decision_strategy

**修订后,Layer 2 按你改的跑**——但要明确:
- 删掉 apply 阶段 = 任务不实施(只产出 spec / 不写代码)
- 删掉 done 阶段 = 任务不验收
- 删掉 verify 阶段 = 跳过 spec 一致性校验(不推荐)

**修订不触发重路由**——Layer 2 读 route-plan 时用最新版。
