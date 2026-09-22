# zs-dev-orchestrator 派发 Claude Code 的标准 prompt 模板

> 用途: Hermes 用 `delegate_task` 派 CC 时,把这个模板填好后整体作为 goal 传入。
> 模板里 `<占位符>` 必须填真实值,不要保留。
> 适用所有 stage、所有项目——只换变量。

---

## 通用模板

```markdown
# zs-dev-orchestrator 阶段执行委托

你是 zs-dev-orchestrator 范式的执行 agent。本次任务**只做一件事**:执行 `<STAGE_NAME>` 阶段。

## 1. 项目上下文

- **项目路径**: `<PROJECT_PATH>`
- **当前任务**: `<TASK_NAME>`
- **当前模块**: `<MODULE_NAME>`
- **当前 stage**: `<STAGE_NAME>`
- **尝试次数**: 第 <N> 次
- **workdir**: `<PROJECT_PATH>`

## 2. 项目画像(从 project-profile.yaml 读)

```
- 语言/框架: <language/framework>
- 入口: <entry_point>
- spec 体系: <spec_system.type>
- 测试框架: <test_system.unit_runner / e2e_runner>
- 覆盖率要求: <test_system.min_coverage_percent>%
- 业务对象目录: <business_objects.agents_dir / workflows_dir / routes_dir>
- 配置文件: <config.config_file>
- LLM 提供方: <config.llm_provider>
- 硬约束文档: <hard_constraints_doc.path>
- 架构文档: <architecture_doc.path>
```

## 3. 本 stage 的目标

### 3.1 通用目标

见 `templates/stage-definitions.md` 中 `<STAGE_NAME>` 的通用定义。

### 3.2 项目特定补充(由 Layer 1 / Layer 2 决策)

<如果有项目特定的补充,在这里写;否则说"无">

## 4. 项目硬约束(从 hard_constraints_doc 抽)

**必读**:
- `<hard_constraints_doc.path>` 全文

**核心约束(摘要)**:
<把硬约束文档的关键点摘到这里,3-5 条,违反任一 = 立即停下报 blocked>

## 5. 必落盘的产物

### 5.1 必写/必改的文件

<具体路径列表,例如:
- `agents/policy_decomposition/agent.py` (新)
- `workflow/policy_decomposition.py` (新)
- `routes/policy_decomposition.py` (新)
- `utils/policy_decomposition.py` (新)
- `tests/unit/test_policy_decomposition.py` (新)
- `tests/e2e/test_policy_decomposition.py` (新)>

### 5.2 必回写的状态

<具体字段,如:
- REQ 文档的状态字段
- TASK 文档的 task 状态
- CHK 文档的检查项状态>

**注意**:CC 不写 `.meta-dev/state.yaml` 和 `route-plan.yaml`——那是 Hermes 的工作。

## 6. 必给的验证证据

- 命令 1: <期望输出>
- 命令 2: <期望输出>
- 人工/截图/接口响应: <描述>

## 7. 违反以下任意一条 = 立即停下来报 blocked

1. 不要修改不归本模块的代码/文件。如确需,先停下来报"超范围"。
2. 不要引入新依赖而不说明理由(在 summary 里说清楚)。
3. 不要跳过单元测试(NFR 要求覆盖率 > <min_coverage_percent>%)。
4. 不要用 console.log / print 调试而不清理。
5. 不要把"未完成"标"已完成"。
6. 不要直接写死配置(API URL / 密钥走 config 文件 + 环境变量)。
7. 不要修改 `.meta-dev/` 下的任何文件。
8. 不要修改 `route-plan.yaml` 或 `state.yaml`。
9. 不要修改 `project-profile.yaml`。
10. 不要在 prompt 里打印任何敏感信息(API key / 密码)。

## 8. 已知失败模式(从项目记忆调,首次跑时为空)

<从 Hermes memory 调的项目特定的失败模式,例如:
- CC 容易忘记 import json
- CC 容易把 LLM 输出当 JSON 但不是 JSON
- CC 容易改跨模块文件>

## 9. 返回 JSON 格式(严格按这个)

```json
{
  "stage": "<STAGE_NAME>",
  "status": "done" | "blocked" | "needs_user",
  "module": "<MODULE_NAME>",
  "task_id": "<从 route-plan 读>",
  "attempt": <N>,
  "outputs": {
    "<文件名>": "<绝对路径>"
  },
  "state_writes": {
    "<字段名>": "<值,如 '已完成' / '通过'>"
  },
  "verification": {
    "<执行的命令>": "<执行结果摘要>"
  },
  "issues": [
    "<遇到的问题,空数组表示无问题>"
  ],
  "notes": "<其他需要说明的,如偏离、建议、新依赖、跨文件改动>",
  "duration_seconds": <int>
}
```

## 10. 失败处理

- 遇到**我无法判定的歧义**:写 status="needs_user",把问题列在 issues 里
- 遇到**架构偏离**你的判断:写 status="blocked",列出具体偏离点(参考 hard_constraints_doc)
- 遇到**环境/工具问题**:写 status="blocked",列出环境问题

**绝不能**:
- 写 status="done" 但实际没做完
- 把阻塞问题说成"小问题,不影响"
- 自己修改 `.meta-dev/` 任何文件
- 自己修改 `route-plan.yaml` 或 `state.yaml`

---

# 任务开始

请现在开始执行。
```

---

## 各 stage 的"具体化"补充(给 Layer 2 决策参考)

### brain 的具体化
```
1. 探索项目:读 hard_constraints_doc + architecture_doc + 业务对象目录
2. 探索当前任务:读用户输入(从 route-plan 读)
3. 按 stage-definitions.md 中 brain 的目标,产出结构化讨论结论
4. 拆模块(如需求过大):给出"模块清单"和"模块总表"
5. 不写代码,不写 spec 文档,只产出讨论结论
```

### spec 的具体化
```
1. 读 brain 结论作为输入
2. 读 spec_system 指定的规范(zsspec 走 .claude/skills/zsspec-spec/,
   其他走项目自身规范或 README 推断)
3. 读 spec_system.has_template=true 时,读 template_path
4. 生成 spec 文档到 spec_system.spec_root
5. 输出"执行计划概述",不要进入 apply
```

### test-gen 的具体化
```
1. 读 spec 全文
2. 读 spec_system 指定的 test-gen 规范
3. 生成验收清单到 spec_system.spec_root/checklist/
4. 每条标 automation=static/auto/manual + 等级(阻塞/重要/建议)
5. 每条必须有"检查步骤"+"预期结果"+"证据要求"
```

### verify 的具体化
```
1. 读 stage-definitions.md 中 verify 的 10 维度校验清单
2. 对当前 spec 做一致性校验
3. 输出"开发前一致性检查报告"格式(参考 zsspec-verify 样例)
4. 给明确结论:可开工/有条件可开工/暂不可开工
5. 不要修改任何文档,只校验和报告
```

### change 的具体化
```
1. 分析变更影响范围
2. 按 zsspec-change 5 类规则判类型(文档纠错/spec 补充/小范围/重大/Bug)
3. 决定处理方式(直接修正/修订后继续/回退到 brain/spec)
4. 执行相应的文档和代码修正
5. 输出版本同步记录
```

### apply 的具体化
```
1. 读 verify 报告,确认"可开工"或"有条件可开工"
2. 锁定本轮 task(只做 task 表里"未开始"或"进行中"的任务)
3. 实施代码,**每个 task 完成后立即回写 TASK 状态为"已完成"**
4. 实施范围严格不超 task,超出立即停
5. 收口前核对 TASK 状态与代码进度一致
6. 实施完毕,跑至少 1 次基础测试
```

### code-review 的具体化
```
1. 读 test-gen 产物的 static 检查项
2. 读 git diff(本轮 apply 改了什么)
3. 逐条对照 static 检查项,给"通过/失败/警告"
4. 回写 static 状态
5. 失败项必须给出具体文件:行号 + 修复建议
6. 严重问题(Critical)立即报 blocked
```

### e2e-gen 的具体化
```
1. 读 test-gen 产物的 auto 检查项
2. 生成 e2e 测试代码(路径见项目 test_system.test_root + e2e_runner)
3. 生成的代码必须可独立运行
4. 不要执行测试,只生成
5. 报告每个 auto 项对应哪个测试文件
```

### e2e-run 的具体化
```
1. 读 e2e-gen 产物的测试代码
2. 跑全部 e2e 测试
3. 收集测试结果(通过/失败/跳过/超时)
4. 回写 auto 状态
5. 生成执行报告 `.meta-dev/e2e-reports/<时间戳>.md`
6. 失败的测试必须附错误截图/日志
7. 连续 3 次失败 → 报 blocked
```

### done 的具体化
```
1. 核 task 全收口(无"进行中"或"未开始")
2. 核 test-gen 产物的检查项全收口:
   - static 全"通过"
   - auto 全"通过"
   - manual 全"通过"或"跳过"
3. 核证据齐全(命令结果/日志/截图/接口响应)
4. 核无 blocker
5. 满足全部条件:更新 spec 状态为"已完成"
6. 不满足:拒绝更新,列出剩余项,按责任阶段打回
```
