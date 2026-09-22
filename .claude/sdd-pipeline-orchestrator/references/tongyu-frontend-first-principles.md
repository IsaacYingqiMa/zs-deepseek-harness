# AI-competition (tongyu-frontend) — First-Principles Reference

Use this reference when `sdd-pipeline-orchestrator` is running against `D:\InspurCode\AI-competition` or when the user mentions "tongyu", "tongyu-frontend", "TONGYU Bridge", "BattleEvent", or "工位地图". It captures the project's substance constraints — the rules the supervisor must enforce during apply / code-review, in addition to the SDD workflow gates.

The project is **the visualization frontend for an SDD pipeline** (the "AI研发作战指挥中心"). It does NOT produce software itself; it consumes BattleEvent streams and renders a sand-table workstation map. When the user asks the supervisor to "把 zsdev 真实状态推到 tongyu-frontend 显示", the supervisor's job is to bridge the gap between the supervisor's own `.meta-dev/state.yaml` and the frontend's WebSocket protocol — see `references/zsdev-to-tongyu-bridge.md` for that recipe.

## Project identity

- **System name**: 统驭 · TONGYU — AI 研发作战指挥中心
- **Domain**: real-time visualization of multi-agent SDD pipeline execution; AI competition demonstration
- **Stage**: active, mock-mode working end-to-end; real-data mode (Bridge) pending
- **Source paths**:
  - Specs: `specs/requirement/tongyu-frontend/`, `specs/design/tongyu-frontend/`, `specs/task/tongyu-frontend/`, `specs/checklist/tongyu-frontend/`
  - Frontend: `tongyu-frontend/` (Vue 3 + Vite)
  - Skill suite: `.claude/skills/zsspec-*` (12 skills, fully populated)
  - Hard constraints: `specs/design/tongyu-frontend/DES-tongyu-frontend-前端.md` (v0.3) + `DES-tongyu-frontend-后端.md` (v0.1)
  - Bridge SPEC entry point: `DES-tongyu-frontend-后端.md` §"数据流总览" describes the Bridge layer

## Frontend tech stack (the supervisor must not change without user approval)

| Layer | Choice | Version | Why |
|-------|--------|---------|-----|
| UI framework | Vue | 3.4.21 | Composition API + script setup |
| State | Pinia | 2.1.7 | Setup-style store in `battleStore.ts` |
| Animation | GSAP | 3.12.5 | Station activation, packet flight, HARD GATE |
| 3D | Three.js | 0.162.0 | FinalSummon particle cloud |
| Build | Vite | 5.2.6 | Dev port 5173 |
| Lang | TypeScript | 5.4.3 | vue-tsc for type-checked build |
| Routing | (none yet) | — | Single view `CommandCenter.vue`; station details via Modal — when adding routes, use `vue-router` 4 |

## Architecture style (v0.3 — sand-table workstation map)

| Pillar | What it says | Drift signals to catch |
|--------|--------------|------------------------|
| **3×3 workstation grid + center + floating** | 9 stations in fixed positions; agents stand at their default station | CC relocates stations or has agents flow between stations |
| **Agent stays at default station** | Position is fixed; only animation changes per status | CC introduces `moving` state across station hops (rare event, not normal flow) |
| **Dashed-line connections** | Station-to-station collaboration edges (not strict workflow arrows) | CC replaces dashed lines with strict flow arrows |
| **Central victory point** | Final summon happens at center, not bottom | CC moves FinalSummon to bottom "胜利广场" — this was v0.2 and is now explicitly removed |
| **BattleEvent is single source of truth** | Frontend never mutates state directly | CC adds buttons that call `battleStore.updateAgentState()` — reject; must go through Bridge |

## 9 stations (canonical IDs — never rename)

```
(1,1) brain         → 侦察基地   [P0: max + sage]   zsspec-brain
(2,1) spec          → 文档工厂   [P0: alex]          zsspec-spec
(3,1) verify        → 检查哨所   [P0: vera + sentinel] zsspec-verify (HARD GATE)
(1,2) apply         → 代码车间   [P0: code-ninja]    zsspec-apply
(2,2) review        → 审查哨所   [P0: guard + inspector] zsspec-code-review
(3,2) e2e           → 测试靶场   [P0: test-master]   zsspec-e2e-run
(1,3) done          → 部署前线   [P1: atlas]         zsspec-done
center victory      → 终局中心   [P2: victor]
floating change     → 仲裁席     [P2: judge]
```

## 12 agents (canonical IDs — never rename)

`max` / `alex` / `vera` / `code-ninja` / `guard` / `inspector` / `test-master` / `atlas` / `victor` / `sage` / `sentinel` / `judge`. Full role + emoji + color + tool mapping is in `src/data/agents.ts`.

## BattleEvent protocol (the bridge contract)

9 event types — the supervisor must emit these via Bridge, not invent new ones:

| Type | Payload | When to emit |
|------|---------|--------------|
| `AGENT_STATE_CHANGE` | `{agentId, status, stage, position, progress, message?}` | Every status flip on any agent |
| `STAGE_STATE_CHANGE` | `{stageId, status, progress, metrics?, report?}` | Stage activation / progress / completion |
| `DATA_PACKET` | `{fromStageId, toStageId, packetType, color}` | Stage-to-stage handoff |
| `WAR_REPORT` | `WarReport` object | Stage completion (paired with STAGE_STATE_CHANGE) |
| `DANMAKU` | `{agentId, agentName, agentColor, content}` | Agent thought messages (max 30 in queue) |
| `HARD_GATE` | `{stageId:'verify', state, progress, checks[]}` | Verify stage start / pass / block |
| `FINAL_SUMMON` | `{appTitle, appContent, appUrl, totalDuration, totalChk, totalChkPass, totalReview, performance, defectCount}` | All 6 main stations complete |
| `ARTIFACT` | `{id, type, name, path, stageId, taskId?, chkId?, evidenceChain[]}` | Stage artifact produced |
| `STAGE_PROGRESS` | `{stageId, progress}` | Periodic progress update (rare; STAGE_STATE_CHANGE covers most) |

`source` field must be `'hermes'` for events the supervisor emits (never `'bridge'` — bridge is just transport, not author).

## Dual-mode frontend (VITE_USE_MOCK)

| Mode | Env | What it consumes |
|------|-----|------------------|
| Mock (default) | `VITE_USE_MOCK !== 'false'` | Pre-scripted `mockBridge.ts` 5-minute show (~150 events @ 600ms) |
| Real | `VITE_USE_MOCK=false` | WebSocket to `ws://<VITE_BRIDGE_HOST>:8765`, expects BattleEvent JSON |

The frontend already handles both modes via `useWebSocket.ts` line 17. The supervisor's job is to build the Bridge that drives real mode. **Do NOT touch `useWebSocket.ts` or `mockBridge.ts` for real-mode integration** — they already work.

## Mock Bridge as the visual reference

`src/composables/mockBridge.ts` is a complete reference implementation of the BattleEvent emission pattern. Before dispatching any Bridge work, the supervisor should read this file (445 lines) to internalize:
- Station activation sequence (brain → spec → verify → apply → review → e2e → done → victory)
- HARD GATE dual-event pattern (state='pending' then state='passed' with same checks list)
- WarReport metric shape and contribution list
- AGENT_MOVE custom event (line 304 — note this is NOT in the canonical 9-type list; it's an implementation-specific escape hatch)

## HARD GATE visual contract (verify stage only)

The frontend treats `stageId === 'verify'` as HARD GATE regardless of payload. If `state === 'passed'` triggers `screenShake 0.4s` + golden gate animation; if `'blocked'` triggers red gate. **Never emit HARD_GATE events for non-verify stages** — the frontend will not animate them but it's misleading.

## Failure mode seed

- **CC renames station IDs** (e.g. `brain` → `reconnaissance`) — breaks all event payloads and mock scripts; always load `src/data/stations.ts` before any frontend dispatch
- **CC adds new BattleEvent types without updating the type union** in `src/types/battleEvent.ts` — TypeScript will fail build, but the supervisor should catch it at design time
- **CC places HARD GATE animation on non-verify stages** — the `HardGateAnimation.vue` listens for `hardGateState` to be truthy, which is set by any HARD_GATE event; only emit HARD_GATE for verify
- **CC uses `useWebSocket.sendCommand()` to inject state** — this only sends to Bridge, never mutates local state; if the user wants state changes to be reflected locally, the supervisor must dispatch through the Bridge round-trip, not direct store mutation
- **CC bypasses the `v0.3` design and reverts to vertical flow** — v0.2 is explicitly removed; supervisor must reject any "StageNode.vue" implementation that uses y=80, y=180, ... (vertical positions from v0.2)

## What this file does NOT cover

- The Bridge implementation itself — see `references/zsdev-to-tongyu-bridge.md`
- The competition packaging layer — see `competition-submission-packaging` skill (tongyu is a showcase target, not a submission itself)
- The mock script generation — `src/composables/mockBridge.ts` already covers this and should not be regenerated

## Related files

- `references/zsdev-to-tongyu-bridge.md` — the TONGYU Bridge implementation recipe (Python watchdog → WebSocket → frontend)
- `references/zkproject-first-principles.md` — sibling reference for the original Bisheng project
- `src/types/battleEvent.ts` — canonical event schema
- `src/data/stations.ts` — canonical station coordinates and colors
- `src/data/agents.ts` — canonical 12-agent configuration