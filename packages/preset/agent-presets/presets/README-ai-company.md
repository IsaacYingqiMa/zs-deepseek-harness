# AI 公司 · 单一 Preset 完整组织

`presets/ai-company` 是一个 preset,包含完整的 AI 公司组织。**选它创建 session,输入业务事件,整个公司自动组建并运转。**

> **结构注意**:preset 是 `presets/` 根下的直接子目录,不能嵌套在容器目录里 —— dsh 的 discovery 不扫描嵌套目录。

---

## 架构:单 composition + 角色化 fork

旧版(7 个独立 preset)在 DSH 上跑不通,因为 **fork 只能继承父的 composition,无法 fork 出别的 preset**。

新版回到旧 CEO 的单 composition 模式,升级为**角色化 fork**:

```
用户在 web UI 选 "AI 公司(完整组织)" 创建 session
  = 董事长(完整工具集,persona 禁止自用)
       │ subagent_fork_gm (persona=总经理, deny fork_gm)
       ▼
     总经理
       │ subagent_fork_cto (persona=CTO, deny fork_gm+cto)
       ▼
      CTO
       │ subagent_fork_pm (persona=PM, deny fork_gm+cto+pm)
       ▼
      PM ──┬─ subagent_fork_designer (叶子,deny 全部 6 个 fork)
           ├─ subagent_fork_dev     (叶子)
           └─ subagent_fork_tester  (叶子)
```

### 关键机制

| 机制 | 实现方式 |
|------|---------|
| 角色边界 | 每个 fork 工具的 `config.persona` 写死该角色的人设 |
| 层级防越级 | `toolFilter.deny` 链:GM 不能再 fork GM;叶子不能 fork 任何人 |
| 工具继承 | 董事长持完整工具集(bash/web/fs/plan-mode/compaction),子孙继承;各角色 persona 限制用途 |
| Playbook | 7 个 skill(chairman/gm/cto/pm/designer/dev/tester-playbook)在 preset 的 skills/ 下,fork 出的子孙都能加载 |
| 启动序列 | 董事长 persona 写明:启动时先 `subagent_fork_gm`,等"就位"回复,再走 checklist |

### 层级 deny 链

| fork 工具 | 被 deny 的工具 | 效果 |
|-----------|---------------|------|
| `subagent_fork_gm` | fork_gm | 总经理不能再 fork 总经理 |
| `subagent_fork_cto` | fork_gm, fork_cto | CTO 只能往下 fork PM |
| `subagent_fork_pm` | fork_gm, fork_cto, fork_pm | PM 只能 fork 叶子 |
| `subagent_fork_designer/dev/tester` | 全部 6 个 | 叶子执行者,不能再 fork |

---

## 启动流程

```bash
cd D:\InspurCode\zs-deepseek-harness
pnpm dsh web
```

打开 `http://127.0.0.1:3080` → preset 选 **"AI 公司(完整组织)"** → 新 session → 输入业务事件。

### 董事长的启动序列(写在 persona 里,自动执行)

1. `list_agents` 发现没有总经理
2. 调 `subagent_fork_gm`,brief:"你是总经理,请加载 gm-playbook skill,回复'就位'"
3. 总经理加载 skill,回复"就位"
4. 董事长开始 checklist 协议

---

## 测试输入

```
客户 AC Corp(省级政府采购中心)要求做一个标书审核智能体,6 周交付,
启动金 200 万。要求支持 PDF/Word 上传、字段提取、合规规则匹配、
报告生成四个核心功能。
```

预期:董事长 checklist → 总经理 → fork CTO → fork PM → fork 三人组 → 会议 → 交付。

---

## 通信协议

- **父子**:直接 `send_message`(董事长↔总经理↔CTO↔PM↔设计/研发/测试)
- **兄弟**(设计↔研发↔测试):**必须经 PM 中转**。PM 的 playbook 写了 MANDATORY RELAY 规则
- 每个 fork 的 persona 都写明 `FIRST ACTION: 加载对应 playbook skill`

## Checklist 协议(所有角色)

```
1. 收到任务 → 发布自己的 [Checklist]
2. send_message 跟对方逐条确认
3. 全部 ✓ → 输出最终决策 / 交付物
```

各角色的 checklist 模板见 `skills/<role>-playbook/SKILL.md`。

---

## 文件结构

```
ai-company/
  agent.cordis.yml     # 完整 composition(含 6 个角色化 fork 工具)
  preset.yml           # 显示名 + 描述
  skills/
    chairman-playbook/SKILL.md
    gm-playbook/SKILL.md
    cto-playbook/SKILL.md
    pm-playbook/SKILL.md
    designer-playbook/SKILL.md
    dev-playbook/SKILL.md
    tester-playbook/SKILL.md
```

## 已知边界

- 角色隔离靠 persona(软约束)+ toolFilter.deny(硬约束,fork 层面)。叶子角色仍继承 bash 等工具,靠 persona 禁止滥用。
- LLM 可能偏离 checklist 协议;若某角色漏了步骤,在其 session 里追加引导。
- 设计↔研发↔测试的兄弟通信依赖 PM 主动转发;PM playbook 已写 MANDATORY RELAY,但 LLM 仍可能漏。
