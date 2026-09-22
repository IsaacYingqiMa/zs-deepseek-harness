# zsspec 14-Skill Stage Map — Concrete Reference

This is the reference shape captured from the user's zsspec skill suite in `D:\InspurCode\zk-project\.claude\skills\zsspec-*`. Use it as a concrete example when a user's SDD suite is similar. Adapt the names if the user's suite is different.

## The 14 skills and their role in the pipeline

| Stage order | Skill | What it does | HARD-GATE(s) found in SKILL.md | Human checkpoint? |
|-------------|-------|--------------|--------------------------------|-------------------|
| 0 (one-time) | `zsspec-init` | Generate project CLAUDE.md, design dir | none obvious | no |
| 1 | `zsspec-brain` | Discussion → structured conclusion | "在呈现设计并获得用户认可之前,禁止调用任何实现技能"; "在需求讨论完成后,禁止自动调用 zsspec-spec" | **yes — post** |
| 2 | `zsspec-spec` | Generate REQ / DES-前端 / DES-后端 / TASK; suggest test-gen | "未经用户明确确认,禁止在 spec 生成完成后自动进入 zsspec-apply 或任何开发动作" | **yes — post** |
| 3 | `zsspec-test-gen` | Generate CHK with automation=static/auto/manual markers | none obvious | no |
| 4 | `zsspec-verify` | Consistency check + go/no-go for apply (subfeature / module / global scope) | "在完成 verify 并给出"允许进入 apply"的结论前,禁止直接进入 zsspec-apply"; "若 REQ/DES/TASK/CHK 之间存在影响当前开发范围的关键断链...不得判定为可开工" | no (but may block dispatch) |
| 5 | `zsspec-apply` | Implement code, update REQ/TASK status in real time | "若仍存在关键歧义、文档冲突,或用户尚未明确允许进入实现,则不得直接开始开发"; "未锁定当前正在执行的 task,不得直接开始开发或扩展实现范围" | **yes — mid (on scope expansion)** |
| 6 | `zsspec-code-review` | Static review against CHK `automation=static` items | none obvious | no |
| 7 | `zsspec-e2e-gen` | Generate Playwright tests for CHK `automation=auto` items | none obvious | no |
| 8 | `zsspec-e2e-run` | Run Playwright tests, write back CHK `automation=auto` status | none obvious | no |
| 9 | `zsspec-done` | Final acceptance — set REQ status to 已完成 or rollback | "前序 TASK / CHK 状态未收口时,不得直接更新 REQ 为 已完成"; "若验收中发现漏项、错误...应回到修复路径或 zsspec-change,不得强行标记完成" | **yes — final acceptance** |
| cross-cutting | `zsspec-change` | Handle scope changes / bug fixes at any stage | "影响 REQ/TASK 的变更,优先先修文档,再继续开发或验收"; "影响模块边界的变更,必须回退到 zsspec-brain 重新收敛" | **conditional (重大变更)** |
| reference | `zsspec-standard` | Template spec; not directly executed | n/a | n/a |
| reference | `zsspec-review` | Companion to verify; review-oriented flow | n/a (similar to verify) | n/a |

## Flow diagram (from `zsspec-skills/README.md`)

```
init → brain → spec → test-gen → verify → apply → code-review
         ↑      ↑        ↑         ↑        ↑            ↑
         └────── change ─┴─────────┴────────┴────────────┘
                                          └→ e2e-gen ─→ e2e-run ─→ done
```

## State field ↔ zsspec field mapping

When the supervisor builds a module state file for a zsspec project, the zsspec-specific status fields map like this:

| Supervisor state field | zsspec field / file | Notes |
|------------------------|---------------------|-------|
| `stage_artifacts.spec` | `specs/requirement/<module>/REQ-<module>.md` + `specs/design/<module>/DES-...-前端.md` + `DES-...-后端.md` + `specs/task/<module>/TASK-<module>.md` | All 4 must exist before apply |
| `stage_artifacts.test_gen` | `specs/checklist/<module>/CHK-<module>.md` | Must contain items with `automation=static/auto/manual` |
| `stage_artifacts.verify` | verify report (path depends on user convention — may be inline in the conversation) | Must contain go/no-go decision |
| `stage_artifacts.apply` | git commits on the feature branch | TASK status must be "已完成" for every task claimed done |
| `stage_artifacts.code_review` | static items status writes in CHK | `automation=static` items moved to "通过" or "失败" |
| `stage_artifacts.e2e_run` | `automation=auto` items status writes in CHK | Must include execution report |
| `human_checkpoints_passed.final_acceptance` | REQ status field = "已完成" | The terminal state |

## HARD-GATE locations to inline verbatim in every handoff

When the supervisor packs a handoff for a zsspec stage, these specific HARD-GATEs must be copied into the prompt **as written below** (or the user's localized equivalent):

### For `zsspec-brain`:
> 在呈现设计并获得用户认可之前,禁止调用任何实现技能、编写任何代码或执行任何实现操作。
> 在需求讨论完成后,禁止自动调用 zsspec-spec。必须等待用户明确发出"可以生成 spec""开始生成 spec""进入 spec"等指令后,才允许进入 zsspec-spec。

### For `zsspec-spec`:
> 未经用户明确确认,禁止在 spec 生成完成后自动进入 zsspec-apply 或任何开发动作。

### For `zsspec-verify` (when invoked as a gate before apply):
> 在完成 verify 并给出"允许进入 apply"的结论前,禁止直接进入 zsspec-apply。
> 若 REQ / DES / TASK / CHK 之间存在影响当前开发范围的关键断链、关键遗漏、关键不匹配或关键未决项,不得判定为可开工。

### For `zsspec-apply`:
> 若仍存在关键歧义、文档冲突,或用户尚未明确允许进入实现,则不得直接开始开发。
> apply 阶段的开发最小执行单位是 TASK。未锁定当前正在执行的 task,不得直接开始开发或扩展实现范围。
> 开发过程中每完成一个任务,应立即将对应 TASK 状态回写为 `已完成`;不得把常规状态回写累计到 zsspec-done 再统一补写。

### For `zsspec-done`:
> done 的默认行为是核对与判定,不是补写与代执行。前序 TASK / CHK 状态未收口时,不得直接更新 REQ 为 `已完成`。
> 若 TASK / static / auto / manual 任一未完成、未回填或缺证据,done 必须拒绝修改 REQ 状态,并明确打回对应阶段。

### For `zsspec-change`:
> 影响 REQ / TASK 的变更,优先先修文档,再继续开发或验收。
> 影响模块边界的变更,必须回退到 zsspec-brain 重新收敛。
> 在完成变更分类前,禁止直接进入代码实现。

## Why this reference exists

The supervisor skill itself stays generic. But the next session loading `sdd-pipeline-orchestrator` for THIS user's project will need to know:

1. The user's specific stage names (zsspec-* prefixed, not generic)
2. The user's specific HARD-GATE text (so it can inline it verbatim in handoffs)
3. The user's specific status field locations (TASK / CHK / REQ)

This file is the bridge. Treat it as a session-specific excerpt — when the user moves to a different SDD suite, this file should be replaced with the new suite's analog.
