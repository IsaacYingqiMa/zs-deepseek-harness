# cc-delivery.md 增量补丁 (2026-06-24)

> 本文件记录本会话新发现的派发经验, 准备未来整合到 cc-delivery.md 主体。在那之前, 增量先放这里作为执行参考。

## A. max-turns 表新增 2 行

文档级 change 任务(同时改多份大 spec 文档)需要 max-turns=60-80, 不再是默认的 30。

```markdown
| 任务类型 | 推荐 max-turns | terminal timeout | 产物大小经验 |
|---|---|---|---|
| ... (原有 8 行不变) |
| 文档级 change(同时改 4 份 spec) | 60-80 | 900s+ | 4 份合计 80-120KB |
| 接力 CC(只补 1 份未完成 spec) | 30-40 | 600s | 单份 15-30KB |
```

**文档级 change 的 max-turns 教训**(真实踩坑, 2026-06-24):
- 让 CC "一次性改 4 份 spec" 即使是简单追加小节, max-turns=30 也会跑满
- CC 在多份大文件(每份 100-200KB)之间反复 Read/Edit, 内部 turn 消耗极快
- 正确做法: 文档级任务一开始就给 max-turns=60-80, 别等 "reached max turns" 再接力

## B. 第 10 节"常见坑表"新增 1 行

| 坑 | 症状 | 修复 |
|---|---|---|
| ... (原有坑不变) |
| 接力 CC 误读版本号 | 接力 CC 读了已有 changelog 但漏看, 写了错的 v2.x / 重复 changelog 条目 | 接力 prompt 必须显式列出已完成项 + 当前版本号; Hermes 自己用 patch 兜底修正 |

典型症状(本会话真实发生):
- 接力 CC 看到 DES-后端.md 已有 v3.10, 但误以为是 v2.x 系列, 写成 v2.13 (跳号)
- 接力 CC 同时插入两个版本号 changelog 条目(v2.12 + v2.13), 重复登记
- 修复方式: Hermes 看到版本号不一致直接用 patch 改头部 + 合并变更记录(属于"清理型 patch", 不属于改实现, 不违反范式边界)

## C. 第 11 节"与范式边界的关系"新增 1 行

Hermes 对 CC 产物的"清理型 patch"是允许的, 不属于改实现:
- 合并 CC 写出的重复章节(如 DES 后端同时有 1.2.2.2.7 和 12.2.1)
- 修正 CC 写错的版本号头部 + 重复 changelog 条目
- 删除 CC 误加的占位 / 注释 / TODO

但禁止用 patch 改:
- 业务代码实现逻辑(让 CC 改)
- spec 的验收标准 / 处理规则 / 业务边界(让 CC 改)
- TASK 状态回写(让 CC apply 阶段自己回写)

判定原则: 改动是否改变"CC 派发任务里定义的目标行为"? 否 -> 清理型 patch 允许; 是 -> 派 CC 改。

## D. 接力 CC prompt 模板新增

接力 CC prompt 必须包含 4 段:

```markdown
## 上一轮已完成 (不要再改!)
1. <文件 A>: 已完成的具体改动简述
2. <文件 B>: 已完成的具体改动简述
3. <文件 C>: 已完成的具体改动简述

## 本轮只做 1 件事
修订 <文件 D>, 这是当前唯一未完成的 spec.

## 关键上下文 (避免接力 CC 误读)
- 当前版本号: <具体写清楚, 不要让 CC 自己猜>
- 已完成的 3 份 spec 当前版本号: <逐一列出>
- 接力 CC 必须严格按已有版本号体系续写

## 硬约束
- 只改 <文件 D>
- 禁止 git commit / 禁止改其他文件
```

第 3 段是关键反误读护栏——不写明版本号, 接力 CC 大概率会自己读 changelog 然后写错。

## E. 实战样例 (zk-project 2026-06-24 接力)

主 CC 跑 max-turns=30 跑满, 完成 3/4 份 spec。接力 prompt 的写法:

```markdown
## 上一轮已完成 (不要再改!)
1. D:\InspurCode\zk-project\specs\requirement\知识管理-RAG对话\REQ-知识管理-RAG对话.md — 已追加 v2.12 修订条目 + 新 REQ 子条目 ## REQ-知识管理-RAG对话-产品推荐基金过滤-AIC基金用户主动提及放行
2. D:\InspurCode\zk-project\specs\task\知识管理-RAG对话\TASK-知识管理-RAG对话.md — 已追加 6 个新子任务 (TASK-...AIC放行-*)
3. D:\InspurCode\zk-project\specs\checklist\知识管理-RAG对话\CHK-知识管理-RAG对话.md — 已追加 4 个新检查项

## 本轮只做 1 件事
修订 D:\InspurCode\zk-project\specs\design\知识管理-RAG对话\DES-知识管理-RAG对话-后端.md, 这是当前唯一未完成的 spec.

## 关键上下文
- 该文件实际版本号是 v3.10 (在 DES 后端 md 头部第 3 行)
- 已完成的 3 份 spec 当前版本号: REQ v2.12 / TASK v2.12 / CHK v2.12
- 接力 CC 必须严格按 DES 后端 v3.x 系列续写 (v3.10 -> v3.11)
- 不要把 DES 当作 v2.x 系列(这是 4 份 spec 跨版本体系共存的既定事实)
```

但即使写了这段, 接力 CC 还是把 DES 写成 v2.12 / v2.13 跳号。教训: **再具体的版本号约束都不能 100% 防止 CC 误读, Hermes 必须在 verify 阶段独立核对版本号**。