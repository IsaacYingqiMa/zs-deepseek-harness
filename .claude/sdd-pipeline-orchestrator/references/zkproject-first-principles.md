# zk-project (Bisheng / 卓数智库) — First-Principles Reference

Use this reference when `sdd-pipeline-orchestrator` is running against `D:\InspurCode\zk-project` (or its future equivalents). It captures the project's *substance* constraints — the rules the supervisor must enforce during apply / code-review, in addition to the workflow gates encoded in the SDD suite.

**Do not load this file for other projects.** Each project should have its own first-principles reference, or this skill should be run in generic mode without project-specific drift detection.

## Project identity

- **System name**: Bisheng (卓数智库) — AI knowledge management + content generation platform
- **Domain**: enterprise knowledge management, intelligent content generation
- **Stage**: active development, has accumulated 11+ versions of the RAG-dialogue REQ (current v2.11)
- **Source paths**:
  - Frontend: `zk_frontend/` (React 18)
  - Backend: `zk_backend/` (Django 5.0)
  - Spec system: `specs/`, `spec-template/`, `.claude/skills/zsspec-*/`
  - Hard-constraints doc: `CLAUDE.md` (read this on every dispatch)
  - Architecture doc: `specs/design/01-architecture.md` (read on every apply dispatch)
  - NFR doc: `specs/requirement/01-non-functional.md` (cross-check at code-review)

## Architecture style (the four pillars the supervisor must enforce)

| Pillar | What it says | Drift signals to catch |
|--------|--------------|------------------------|
| **Monolith + microservices hybrid** | Business modules stay as one Django app each; AI capability stands alone | CC introduces a separate Django app for what should be an in-app module, or vice versa |
| **Controller-layer API + Zustand state** | Frontend API in `controllers/API/`, state in `store/` | CC bypasses `controllers/` and calls fetch/axios directly from a page; CC uses React Context for what should be Zustand |
| **Django APP per business module** | One Django app per business module; `urls→views→models` is the layering | CC adds business logic to a view that should be in a model method, or skips the `urls.py` registration |
| **Data tier is fixed** | MySQL 8 (relational) + Redis 7 (cache/session) + Milvus 2.3+ (vector) + ES 8 (fulltext) + MinIO (object) | CC uses Redis for persistent storage, uses MinIO for non-file data, skips Milvus for vector search, etc. |

## Non-functional requirements (the hard numbers the supervisor must verify at code-review)

| NFR | Threshold | How to verify |
|-----|-----------|---------------|
| Page first paint | < 3s | Check the build output size; should be < 5MB first-screen |
| Regular API | < 1s | CC must include a quick benchmark or note why the API is heavier |
| Semantic search | < 3s | If CC adds a new retrieval path, must include latency budget |
| AI first-byte | < 5s | Streaming response must start within 5s |
| File upload processing | < 10s (file-size dependent) | CC's upload handler must show progress for files > 1MB |
| Concurrent users | 100+ | WebSocket 500+ connections, vector retrieval 50+ concurrent |
| Frontend bundle | < 5MB (first screen) | Reject if `npm run build` produces a chunk > 5MB |
| Backend memory | < 4GB normal load | Don't accept CC adding unbounded in-memory caches |
| DB connection pool | max 100 | CC must not open per-request connections |
| **Unit test coverage** | **> 60%** | CC must report coverage; below 60% = reject |
| Auth | JWT (2h access, 7d refresh) + RBAC | Reject any session-cookie or non-RBAC permission model |
| Password storage | BCrypt with random salt | Reject SHA/MD5/plain storage |
| Transport | HTTPS only, TLS 1.2+ | Reject HTTP endpoints |
| Sensitive fields | masked in display (phone, ID number) | Reject raw value display |
| Log retention | ≥ 180 days | Reject log rotation < 180 days |

## Port map (for any dispatch that runs an actual server)

| Service | Port |
|---------|------|
| Frontend dev server | 3001 |
| Backend API | 7860 |
| WebSocket | 8001 |
| MySQL | 3306 |
| Redis | 6379 |
| MinIO API / Console | 9000 / 9001 |
| Milvus | 19530 |
| Elasticsearch | 9200 |

If a dispatch tries to bind a different port, the supervisor must verify the project-level `vite.config.ts` / Django settings before allowing it.

## Spec system (read this section once per module, then load only the relevant files)

- **Naming convention source**: `spec-template/spec-standard/01-spec-rules.md` (the rules file is short — read it on first contact with a new module)
- **Numbering**:
  - Requirement: `REQ-{module path}-{feature}` (e.g. `REQ-知识管理-RAG对话-新建会话`)
  - Design: `DES-{module}-{frontend|backend|topic}` (e.g. `DES-知识管理-RAG对话-后端`)
  - Task: `TASK-{module}-{feature}-{sequence}` (e.g. `TASK-知识管理-RAG对话-新建会话-001`)
  - Checklist: `CHK-{module}-{feature}-{sequence}`
- **Directory layout**:
  ```
  specs/
  ├── requirement/{module}/REQ-{module}.md
  ├── design/{module}/DES-{module}-{frontend|backend}.md
  ├── task/{module}/TASK-{module}.md
  └── checklist/{module}/CHK-{module}.md
  ```
- **CHK classification** (the supervisor must respect the ownership contract):
  - `automation=static` — written by `zsspec-code-review`
  - `automation=auto` — written by `zsspec-e2e-run`
  - `automation=manual` — written by `zsspec-done` or human confirmation
  - **No stage may write a check item belonging to a different `automation` class.** This is a HARD cross-stage contract; if `zsspec-apply` writes a static-pass line, reject.

## Module inventory (so the supervisor can quote it back to the user)

| Domain | Modules |
|--------|---------|
| 系统管理 | 用户管理 / 用户组管理 / 角色管理 / 菜单管理 |
| 知识管理 | RAG 对话 / RAG 对话-向量库定时更新 / 数据分析 / 文件库 / 知识库管理 / 知识搜索 |
| 写作模块 | PPT 写作 / 文章写作 / 智能写作 |
| 对话模块 | AI 对话 / 对话分享 |
| 技能管理 | Assistant 管理 / 工具集 / 技能构建 |
| 模型模块 | 模型微调 / 模型管理 |
| 扩展模块 | 数字人 / 涉农产品推荐 H5 / 移动端 |
| 评测模块 | 效果评测 |

When the user names a module by a partial string, the supervisor matches against this inventory before dispatching.

## Notification channel

- **Feishu chat_id**: `oc_0180579c69b38b5ade3e51d7401edbf5`
- **Why Feishu and not WeChat**: gateway config currently shows weixin as connected but the user explicitly set up Feishu. The supervisor should send to Feishu and gracefully degrade (log to `.zsspec/notifications.log`) if `send_message` returns a `Feishu dependencies not installed` error.
- **Notify-on rules** (do not spam):
  - Stage start / stage end (passed)
  - Stage failure
  - Whole module done (with full summary)
  - Escalation to user
  - Architecture drift caught
  - Do NOT notify on intra-stage progress; only on stage boundary and on the 5 escalation triggers

## Pre-built verify report exemplar (use as parse fixture)

The user's first verify sample (RAG 对话-向量库定时更新, 2026-06-13):

```
结论: 可开工
通过项: 9 / 失败项: 0 / 警告项: 2
必须确认: 无
apply 门禁: allow_apply=true, must_confirm=empty
```

The supervisor must parse reports into a structured shape and decide based on:
- `allow_apply=true` + `must_confirm=empty` → proceed
- `conclusion=有条件可开工` → CC fixes warnings, re-verify
- `conclusion=暂不可开工` or `failed_count>0` → CC revises spec, re-verify, escalate after 3 attempts

Full parsing rules are in `templates/verify-report-parse.md` (created as a stand-alone reference because the rules are project-flavored and grew too long to inline in the handoff pack).

## Failure mode seed (build this up over time)

Start with these known failure modes for zk-project. Add to this list as CC exhibits new patterns.

- **CC touches files outside its module's scope** — usually because the helper it wants lives in another module. CC must propose a refactor or copy the helper; not silently reach across.
- **CC introduces new dependencies without PR justification** — common with LangChain/LangGraph sub-packages. Reject and require a justification note.
- **CC adds console.log debugging and leaves it in** — must clean up before code-review passes.
- **CC uses `print()` for backend logging instead of the project's logging module** — same rule.
- **CC writes new code in the wrong place** (e.g. business logic in `urls.py` instead of `views.py`, or in a model method that should be a view) — enforce the layering.
- **CC forgets to update REQ status from "未开始" → "已完成"** — `zsspec-apply` HARD-GATE enforces real-time writes; the supervisor must check the actual TASK and CHK files, not trust CC's report.
- **CC's "done" claim is not done** — supervisor must run the actual verification commands itself, not trust CC's `verification` field.
- **CC modifies the orchestrator's `state.yaml`** — the orchestrator owns this file exclusively. CC must never touch it.

## Why this file exists

The supervisor skill stays generic. But a real session running against zk-project needs to know:
- The exact NFR numbers (so it can reject at code-review)
- The exact data tier (so it can catch architecture drift)
- The exact spec system layout (so it knows where to read and write)
- The exact module inventory (so it can resolve partial names)
- The exact notification channel (so the user's proctor mode actually works)

Treat this file as a per-project excerpt — when the user moves to a different project, create a sibling reference like `references/<project>-first-principles.md`.
