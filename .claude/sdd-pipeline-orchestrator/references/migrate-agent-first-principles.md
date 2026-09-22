# zdata-agent-starter (migrate_agent) — First-Principles Reference

Use this reference when `sdd-pipeline-orchestrator` is running against `D:\InspurCode\migrate_agent` (a.k.a. zdata-agent-starter). It captures the project's *substance* constraints — the rules the supervisor must enforce during apply / code-review.

**Do not load this file for other projects.** Each project should have its own first-principles reference, or this skill should be run in generic mode without project-specific drift detection.

## Project identity

- **System name**: zdata-agent-starter (zdata 智能体 starter 框架)
- **Domain**: Agno-based multi-agent service framework, *not* a complete business platform. The repository is a skeleton designed for extension.
- **Stage**: active development, has a 47KB target-state architecture plan (`ORCHESTRATION_AND_PLANNER_ARCHITECTURE_PLAN.md`) describing the future workflow-engine + planner architecture.
- **Source paths**:
  - Service entry: `server.py` (FastAPI), `__main__.py` (boot wrapper)
  - Config: `config.yaml` (LLM, embedding, vector DB, knowledge DB, memory, MCP, skills, framework)
  - Agent auto-discovery: `agents/` (recursive, finds `agno.agent.Agent` instances)
  - Team auto-discovery: `teams/` (recursive, finds `agno.team.Team` instances)
  - Workflow auto-discovery: `workflow/` (recursive, finds `agno.workflow.Workflow` instances)
  - Custom routes: `routes/` (non-recursive, mounts `router` with `ROUTE_PREFIX` prefix)
  - Components: `components/knowledge.py`, `components/memory.py`, `components/mcp.py`, `components/skill.py`
  - Architecture doc: `ARCHITECTURE.md` (10KB) — current-state structure & boundaries
  - Target plan: `ORCHESTRATION_AND_PLANNER_ARCHITECTURE_PLAN.md` (47KB) — what it WILL become
  - README: `README.md` (10KB) — most authoritative for current capabilities

## Architecture style (the four pillars the supervisor must enforce)

| Pillar | What it says | Drift signals to catch |
|--------|--------------|------------------------|
| **Auto-discovery at boot** | `server.py` scans `agents/`, `teams/`, `workflow/`, `routes/` and mounts them; no manual registration | CC writes code into a directory that is NOT scanned, or hard-codes a route registration in `server.py` instead of adding a `router` under `routes/` |
| **`agno_agent.*` import namespace** | Source files live in the repo root, but code uses `agno_agent.<module>` import paths. `server.py` adjusts `sys.path` to make this work. **Do not rewrite the layout as a nested `agno_agent/` subdir** — the README explicitly warns against this | CC refactors the file layout into a nested `agno_agent/` directory; CC changes the import namespace to plain `import` (breaks the bootstrap) |
| **Layered structure** | HTTP API Layer → Business Object Layer (`agents/` / `teams/` / `workflow/`) → Component Layer (`components/`) → Runtime Config Layer (`__init__.py`, `config.yaml`) | CC adds business logic in a route that should be in a workflow/agent; CC instantiates `KnowledgeBase` directly in a route instead of through the workflow engine |
| **Workflow Engine + Planner are the target, not the current state** | Current state has only minimal workflow + route. The 47KB plan calls for an enhanced workflow engine + planner team + dynamic builder + policy guard. **This is a migration, not a from-scratch build** | CC writes a parallel orchestration layer; CC proposes to rewrite the existing `policy_checker` workflow instead of migrating it onto the new engine |

## Non-functional requirements (the hard numbers the supervisor must verify at code-review)

| NFR | Threshold | How to verify |
|-----|-----------|---------------|
| Python | 3.10+ | Check `python_requires` in setup / observed runtime version |
| Package manager | `pip` (not poetry, not uv) | Reject `pyproject.toml`-only dependencies not present in `requirements.txt` |
| Model interface | OpenAI-compatible | Reject CC introducing a non-OpenAI SDK without explicit migration plan |
| Vector DB | Qdrant or Milvus (per `components/knowledge.py`) | Reject CC instantiating a different vector store directly in a workflow |
| Knowledge metadata store | SQLite | Reject CC using MySQL/Postgres for knowledge metadata |
| Auth | None at the framework level (framework is infra, not a served product) | Reject CC adding login flows unless the task explicitly calls for it |
| API contract | `ROUTE_PREFIX` per route module | Reject CC using bare `@app.post(...)` calls instead of `APIRouter` with `ROUTE_PREFIX` |
| Service port (default) | 8080 via `server.py`; 8000 via `__main__.py` (intentional mismatch — see ARCHITECTURE.md "当前不一致点") | Reject CC "fixing" the port mismatch without checking which entrypoint the user wants |

## Spec system (zsspec style — fully populated in this project)

This project has its own complete zsspec skill suite under `.claude/skills/`:

| Skill | Role |
|-------|------|
| `zsspec-init` | One-time project bootstrap (CLAUDE.md, design dir) |
| `zsspec-brain` | Discussion → structured conclusion |
| `zsspec-spec` | Generate REQ / DES / TASK |
| `zsspec-test-gen` | Generate CHK with automation markers |
| `zsspec-verify` | Consistency check + go/no-go for apply |
| `zsspec-apply` | Implement code, real-time status writes |
| `zsspec-code-review` | Static review against CHK `automation=static` |
| `zsspec-e2e-gen` | Generate Playwright tests for `automation=auto` |
| `zsspec-e2e-run` | Run Playwright tests, write back `automation=auto` status |
| `zsspec-done` | Final acceptance — REQ status → 已完成 or rollback |
| `zsspec-change` | Scope changes / bug fixes at any stage |
| `zsspec-standard` | Template spec (reference) |

Stage map is identical to the canonical zsspec flow; see `references/zsspec-stage-map.md` for the HARD-GATE table.

**Spec directories are NOT yet created** in this project. The supervisor must create `specs/{requirement,design,task,checklist}/<模块>/` on first apply dispatch if missing, or the user must run `zsspec-init` first.

## Module inventory (so the supervisor can quote it back to the user)

| Domain | Modules / Agents |
|--------|------------------|
| Common agents | `translator` (single Agent baseline), `research_team` (Team baseline), `document_review` (Workflow baseline) |
| File summary | `file_summary_agent` |
| Planner | `planner_team` (Planner Team), `policy` (planner policy module), `registry`, `builder`, `compiler` |
| Policy domain agents | `conclusion_determiner`, `inconsistency_summarizer`, `leader_speech_reviewer`, `local_policy_reviewer`, `national_policy_reviewer_1`, `national_policy_reviewer_2`, `risk_analyzer` |
| Existing workflows | `policy_checker` (7-agent parallel RAG + conclusion), `company_due_diligence`, `file_summary`, `document_review` |
| Existing routes | `policy_checker`, `company_due_diligence`, `file_summary`, `planner` |
| Existing reference data (root) | `政策事项拆解.json` (55KB Bisheng flow), `AI政策摸底-事项打标.json` (241KB), `政策文件示例数据.xlsx` |

**Modules that EXIST in route files but are NOT closed loops** (per README):
- `routes/policy_checker.py` exists but the `policy_checker` workflow it depends on is hand-written and not on the planned enhanced engine
- `routes/company_due_diligence.py` exists but the `company_due_diligence` workflow is hand-written

These are the natural migration targets for the next orchestration cycle.

## Notification channel

- **Feishu chat_id**: `oc_0180579c69b38b5ade3e51d7401edbf5` (same as zk-project — user uses one Feishu for all projects)
- Degradation rules: same as `references/zkproject-first-principles.md`. Feishu is the user's stated channel, but the supervisor must gracefully fall back to `.zsspec/notifications.log` if `send_message` errors out.
- Notify on the same triggers (stage boundary, module done, escalation, architecture drift). Do **not** notify on intra-stage progress.

## Failure mode seed (build this up over time)

Start with these known failure modes for migrate_agent. Add to this list as CC exhibits new patterns.

- **CC creates a nested `agno_agent/` directory.** The README explicitly warns against this. CC may "improve" the layout by adding the directory it's told to import from — the result is duplicate module paths and import errors. Reject the change; remind CC that the bootstrap relies on `sys.path` adjustment in `server.py`.
- **CC hard-codes a route in `server.py`.** New endpoints must go in `routes/<name>.py` with `ROUTE_PREFIX`. Reject and route CC to the right pattern.
- **CC adds business logic in `views.py` / `agents/.../*.py` that belongs in a workflow step.** Workflow orchestration logic must live in `workflow/<name>.py`; agent logic stays narrow (model + instructions). Reject mixing.
- **CC imports a Python module before `server.py` has run its `sys.path` adjustment.** This breaks at runtime when invoked from a route. Reject; CC must defer instantiation to function body.
- **CC uses a non-Agno agent class.** All agents must subclass or instance `agno.agent.Agent`. Reject plain `OpenAI()` or LangChain agents.
- **CC forgets the `name=` kwarg on an Agent/Team/Workflow.** Auto-discovery uses the variable name if `name` is missing, but the `name=` kwarg is the contract. Reject.
- **CC writes a new dependency into `requirements.txt` without a justification note.** The framework relies on a small set of deps; new ones need user sign-off. Reject and require a justification in the PR description.
- **CC's "done" claim is not done.** The supervisor must actually invoke the agent/team/workflow via the API (`POST /api/agents/<name>`, etc.) and confirm the response, not trust CC's `verification` field.
- **CC modifies the orchestrator's state file.** The orchestrator owns `.zsspec/state.yaml` exclusively. CC must never touch it.
- **CC touches the 47KB `ORCHESTRATION_AND_PLANNER_ARCHITECTURE_PLAN.md` while implementing current-state features.** This is the *target* plan, not the current truth. Implementation work goes into the actual code; the plan is a reference, not a build target for the current module.

## Why this file exists

The supervisor skill stays generic. But a real session running against migrate_agent needs to know:

- The framework is *skeleton-first*, not product-first — many routes have no closed loop
- The 47KB plan is a *target*, not the current implementation
- The `agno_agent.*` import namespace is load-bearing
- Auto-discovery is the contract; manual registration is forbidden
- The Python toolchain is `pip` + `requirements.txt`, not poetry/uv
- The user uses one Feishu channel for all projects (no project-specific chat_id)

Treat this file as a per-project excerpt — when the user moves to a different project, create a sibling reference like `references/<project>-first-principles.md`.
