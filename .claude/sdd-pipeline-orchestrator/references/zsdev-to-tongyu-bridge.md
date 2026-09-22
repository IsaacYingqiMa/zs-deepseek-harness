# zsdev → TONGYU Bridge — Architecture & Implementation Recipe

This is the reusable recipe for connecting any SDD/zsspec pipeline supervisor (Hermes + Claude Code orchestration) to the tongyu-frontend real-time dashboard. The pattern is general; this file uses tongyu-frontend as the canonical target.

**Load this reference when**: the user wants to "可视化 zsdev 真实状态", "把 pipeline 状态推到前端", "build TONGYU Bridge", or any similar request that requires exposing `.meta-dev/state.yaml` (or equivalent pipeline state) as a BattleEvent stream over WebSocket.

## The 3-layer pattern (generalizable)

```
┌──────────────────────────────────────────────────────────────┐
│  LAYER 1 — Author: Hermes SDD pipeline (zsdev / sdd-pipeline-orchestrator) │
│    writes .meta-dev/state.yaml + .meta-dev/route-plan.yaml │
│    writes stage artifacts: REQ/DES/TASK/CHK + verify-reports/ │
└──────────────────────────────────────────────────────────────┘
        ↓ file watch (no API coupling)
┌──────────────────────────────────────────────────────────────┐
│  LAYER 2 — Bridge: Python service                              │
│    reads .meta-dev/ via watchdog                              │
│    computes delta (what changed since last poll)              │
│    serializes as BattleEvent (or canonical dashboard event)   │
│    WebSocket broadcast to N subscribers (port 8765)           │
└──────────────────────────────────────────────────────────────┘
        ↓ ws://localhost:8765
┌──────────────────────────────────────────────────────────────┐
│  LAYER 3 — Frontend: tongyu-frontend (or any compatible)      │
│    useWebSocket() subscribes, dispatches to battleStore      │
│    Vue components re-render from reactive state              │
└──────────────────────────────────────────────────────────────┘
```

**Why this 3-layer split**: the supervisor never imports WebSocket libs, the frontend never reads YAML, and the Bridge is dumb (no LLM, no Claude Code, no SDD knowledge — just file watch + JSON serialization). Each layer can be replaced independently.

## File-watch-based coupling is the right choice

Alternatives the supervisor might propose:
- Direct HTTP push from supervisor to frontend → couples the SDD orchestrator to WebSocket details, breaks the "supervisor is generic" property
- Shared database (Redis/Postgres) → introduces infra dependency the user may not have
- IPC (Unix socket / named pipe) → Windows-hostile, debugging pain

**File watch + WebSocket** wins because:
- The supervisor writes YAML anyway (its existing `.meta-dev/state.yaml` IS the canonical state)
- watchdog + pyyaml are stdlib-adjacent, no exotic deps
- WebSocket is the lowest-friction frontend transport (browsers have native support)
- The Bridge can be restarted at any time — supervisor is unaffected, it just keeps writing YAML
- Multiple frontends (or replay tools) can subscribe to one Bridge

## Implementation sketch (Python, ~200 lines)

```python
# tongyu-bridge/bridge.py — minimal viable Bridge
import asyncio, json, time
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import yaml
import websockets

WS_PORT = 8765
META_DEV = Path(r"D:\InspurCode\AI-competition\.meta-dev")  # configurable

class MetaDevHandler(FileSystemEventHandler):
    def __init__(self, broadcaster):
        self.broadcaster = broadcaster
        self.last_state_mtime = 0
        self.last_route_mtime = 0

    def on_modified(self, event):
        if event.src_path.endswith("state.yaml"):
            self.broadcaster.emit_state_change()
        elif event.src_path.endswith("route-plan.yaml"):
            self.broadcaster.emit_route_change()

class Broadcaster:
    def __init__(self, meta_dev: Path):
        self.meta_dev = meta_dev
        self.clients = set()
        self.last_state = None
        self.last_route = None

    async def register(self, ws):
        self.clients.add(ws)
        # Send full state on connect
        await self.send_initial(ws)

    async def emit_state_change(self):
        new_state = self._read_yaml("state.yaml")
        delta = self._compute_delta(self.last_state, new_state, "state")
        self.last_state = new_state
        for event in delta:
            await self._broadcast(event)

    def _compute_delta(self, old, new, kind):
        """Diff two YAML states → list of BattleEvents"""
        # See "Delta computation" section below for the meat
        ...

    async def _broadcast(self, event):
        if not self.clients: return
        payload = json.dumps(event, ensure_ascii=False)
        await asyncio.gather(*[c.send(payload) for c in self.clients],
                             return_exceptions=True)

async def main():
    b = Broadcaster(META_DEV)
    async def handler(ws):
        await b.register(ws)
        try:
            async for msg in ws: pass  # client commands go here
        finally:
            b.clients.discard(ws)
    server = await websockets.serve(handler, "localhost", WS_PORT)
    obs = Observer()
    obs.schedule(MetaDevHandler(b), str(META_DEV), recursive=False)
    obs.start()
    print(f"Bridge running on ws://localhost:{WS_PORT}, watching {META_DEV}")
    await asyncio.Future()  # run forever
```

Key choices:
- `watchdog.observers.Observer` for cross-platform file watch
- `websockets` lib (asyncio-native, simpler than `aiohttp`)
- `_compute_delta` is where the BattleEvent translation lives (see below)
- `register()` sends initial state on connect — frontend can recover from disconnect without asking supervisor to re-run

## Delta computation — the actual hard part

The supervisor writes `state.yaml` shaped like (zsdev template):

```yaml
module: "tongyu-frontend"
stages_completed: [brain, spec]
current_stage: verify
stage_artifacts:
  brain: "specs/requirement/tongyu-frontend/REQ-...md"
  spec: ["specs/design/tongyu-frontend/DES-前端.md", ...]
verify_report: "specs/.../verify-report-2026-08-11.md"
last_run: 2026-08-11T15:43:00Z
next_action: "Dispatch apply"
```

Translation to BattleEvent (for tongyu-frontend target):

| YAML change | BattleEvent emitted |
|-------------|---------------------|
| `current_stage` changes from `brain` to `spec` | `STAGE_STATE_CHANGE` (stageId='brain', status='completed') + `STAGE_STATE_CHANGE` (stageId='spec', status='active') |
| `current_stage` = `verify` | `STAGE_STATE_CHANGE` (stageId='verify', status='active') + `HARD_GATE` (stageId='verify', state='pending', checks=[5 hardcoded items]) |
| `stages_completed` gains `apply` | `STAGE_STATE_CHANGE` (stageId='apply', status='completed') + `WAR_REPORT` (stageId='apply', title='代码实现完成', ...) |
| All 6 main stages in `stages_completed` | `FINAL_SUMMON` (appTitle from `module` field, totalDuration from `last_run - started_at`) |
| New `verify_report` written | `DANMAKU` stream with verification summary lines + `ARTIFACT` for the report file |
| `next_action` changes | `DANMAKU` from `judge` (the floating arbitrator agent): `[next_action] ${next_action}` |

The translation is project-agnostic in shape — only the "what does each stage map to" table is project-specific. Encapsulate the table as `STAGE_EVENT_MAP` in the Bridge.

## Position coordinates — use the project's canonical map

For tongyu-frontend: `STATION_MAP` is in `src/data/stations.ts`. Each station has `position.x, position.y` — copy that map into the Bridge (or import it as JSON if the frontend exposes it). Without canonical coords, agent positions in BattleEvents will be wrong and the map will look broken.

## Backpressure / queue management

If `state.yaml` updates faster than the WebSocket can drain (rare but possible during heavy apply stages):
- **Don't drop events** — frontend visual state depends on every state transition
- Instead, **buffer in `self.clients[i].send` with asyncio.gather(return_exceptions=True)` and let slow clients lag
- If buffer exceeds 1000 pending events, log a warning and start dropping oldest DANMAKU (preserving STAGE_STATE_CHANGE and HARD_GATE)

## Where to put the Bridge in the project

Recommended layout (single fixed workspace, see `references/multi-project-workspace.md` for full design):

```
D:\InspurCode\AI-competition\
├── .meta-dev/                # supervisor writes
├── tongyu-frontend/          # existing frontend
└── tongyu-bridge/            # NEW (or under _tongyu-workspace/, see workspace reference)
    ├── bridge.py             # main service
    ├── __main__.py           # python -m tongyu-bridge entry
    ├── stage_event_map.yaml  # STAGE → BattleEvent translation table
    └── tests/
        └── test_delta.py     # verify delta computation against fixture YAML files
```

The Bridge is **a sibling of tongyu-frontend**, not a child. It has no business with Vue/Node — it's pure Python.

## Connecting the supervisor to the Bridge

The supervisor's `.meta-dev/state.yaml` writes are already happening. Two options for the supervisor to also push to Bridge:

1. **Pure file-watch (recommended)**: supervisor doesn't change at all. Bridge watches YAML and emits events. Zero coupling. Use this unless the supervisor needs to push custom events that don't fit in state.yaml.

2. **Hybrid — supervisor calls Bridge API for non-YAML events** (e.g. real-time CC danmaku that the supervisor wants to surface before the state file is updated). Add a `requests.post(BRIDGE_URL + "/emit", json=event)` call in the supervisor's "after CC dispatch" path. Frontend behaves identically because both sources emit BattleEvent. **Only do this if file-watch misses something — usually it doesn't.**

## Common mistakes to avoid

- **Don't make the Bridge an HTTP-only server** — tongyu-frontend's `useWebSocket.ts` already expects WebSocket; an HTTP server with polling would break the dual-mode UX
- **Don't import the frontend's TypeScript types into Python** — define the BattleEvent schema as Python `dataclass` + a `to_json()` method; the frontend's `src/types/battleEvent.ts` is the contract both sides conform to independently
- **Don't store Bridge state in YAML** — the Bridge is stateless except for `last_state` for delta computation; if you persist Bridge state you've created a second source of truth
- **Don't add auth to the Bridge initially** — it runs on localhost; if remote access is needed, put it behind a reverse proxy with auth, not in the Bridge itself
- **Don't emit events for "no change"** — the supervisor's watchdog will fire on every save, including no-op saves; the delta computation must short-circuit empty deltas to avoid frontend re-render storms
- **Don't recommend `hermes mcp serve` for "let the frontend trigger Hermes"** — it's a Codex tool-bridge with a deliberately limited tool surface. Use tmux/webhook/`chat -q` instead. See "CRITICAL MISCONCEPTION — `hermes mcp serve` is NOT for chat" below.
- **Don't promise "session history preserved across restarts"** — only Shape B (tmux long session) preserves dialogue within a single Hermes run. Cross-restart context comes from memory + disk artifacts, never from chat history.
- **Don't write Hermes-side code that depends on the Bridge being alive** — the supervisor and Bridge must remain decoupled. If the Bridge is down, the supervisor must still complete the task; the Bridge catches up on reconnect by tailing `notifications.log` from the last offset.

## Testing the Bridge end-to-end

Three layers, three tests:

1. **Delta computation unit test** — feed in two `state.yaml` fixtures (one with `stages_completed: [brain]`, one with `[brain, spec]`), assert the Bridge emits exactly 1 `STAGE_STATE_CHANGE` for `spec` and 1 `STAGE_STATE_CHANGE` for `brain status='completed'`. No mock, no async — just function-in / list-out.

2. **WebSocket round-trip test** — start the Bridge in-process, connect a `websockets` client, write a new `state.yaml`, assert the client receives the expected `STAGE_STATE_CHANGE`. Use `asyncio.new_event_loop()` per test.

3. **Frontend integration smoke** — start Bridge, start `npm run dev` for tongyu-frontend, click "▶ 开始 Show" with `VITE_USE_MOCK=false`, verify the HARD GATE animation fires when state.yaml shows `current_stage=verify`.

## Reference impl status

A reference implementation of this Bridge is intended to land at `D:\InspurCode\AI-competition\tongyu-bridge\`. As of 2026-08-11, the project layout, the `stage_event_map.yaml`, and the delta tests are planned but not yet built. CC can implement this whole module in one apply dispatch (200-300 lines) — see `templates/delegation-prompt-zs.md` for the dispatch shape.

## Related

- `references/tongyu-frontend-first-principles.md` — frontend-side constraints (stations, agents, HARD GATE contract)
- `references/zkproject-first-principles.md` — alternative project (Bisheng) — note: this project does NOT need a Bridge; the supervisor and CC communicate directly via file edits
- `competition-submission-packaging` skill — tongyu-frontend is the demo target, not a submission; this skill governs how the user packages zsdev itself as a competition entry
- `templates/delegation-prompt-zs.md` — the CC dispatch shape, useful for "派 CC 实施 Bridge"
- `references/multi-project-workspace.md` — fixed workspace + per-project `.meta-dev/` layout that this Bridge participates in (and the manual startup recipes for tmux/Hermes/dev servers)

---

## Reverse direction: trigger the supervisor FROM the frontend (UI → Hermes)

The 3-layer pattern above describes supervisor → frontend (zsdev writes YAML, Bridge pushes BattleEvents to UI). The user almost always wants the reverse too: the UI sends a requirement ("做个 WS 状态指示器") and Hermes picks it up, runs the SDD pipeline, and the result flows back through the same Bridge.

The reverse path is harder because it has to **invoke Hermes with persistence** (the supervisor needs to keep running across the pipeline, not just respond once). Three proven shapes — listed from simplest to richest.

### Shape A — `hermes chat -q` one-shot (simplest, no persistence)

```bash
hermes chat -q "用 zs-dev-orchestrator 跑一下: <requirement>. 目标模块 <module>. 产物路径 <project_path>" \
  --toolsets terminal,file,delegation,skills \
  --skills zs-dev-orchestrator
```

The Bridge wraps this:

```python
import subprocess
def submit_task(requirement: str, module: str, project_path: str) -> dict:
    result = subprocess.run([
        'hermes', 'chat', '-q',
        f'用 zs-dev-orchestrator 跑一下: {requirement}. 目标模块 {module}. 产物路径 {project_path}',
        '--toolsets', 'terminal,file,delegation,skills',
        '--skills', 'zs-dev-orchestrator',
    ], capture_output=True, text=True, timeout=1800)
    return {"success": result.returncode == 0, "output": result.stdout[-4000:]}
```

Pros: simplest possible. Zero tmux. No background process to manage.
Cons: each call is a **brand-new session** — no in-context dialogue with the user, no memory of prior turns within the same `chat -q` invocation, no ability to ask follow-up questions mid-pipeline. The user's "give Hermes a chat history" expectation is NOT met by this shape.

### Shape B — tmux long session (persistent, equivalent to a normal chat)

```bash
# 1. One-time setup: launch a persistent Hermes session
tmux new-session -d -s hermes-dev -x 120 -y 40 'hermes'

# 2. Wait for startup
sleep 8

# 3. Send a message
tmux send-keys -t hermes-dev "帮我用 zs-dev-orchestrator 跑一下: 做个 WS 状态指示器" Enter

# 4. Read reply (wait N seconds, capture pane, parse)
sleep 15
output = subprocess.check_output(['tmux', 'capture-pane', '-t', 'hermes-dev', '-p', '-S', '-200'])

# 5. Continue dialogue (multi-turn within the same session — conversation history IS preserved)
tmux send-keys -t hermes-dev "跳过 brain,直接进 spec" Enter
```

Bridge helper:

```python
def send_to_hermes(cmd: str, wait_sec: int = 15) -> str:
    subprocess.run(['tmux', 'send-keys', '-t', HERMES_SESSION, cmd, 'Enter'])
    time.sleep(wait_sec)
    return subprocess.check_output(
        ['tmux', 'capture-pane', '-t', HERMES_SESSION, '-p', '-S', '-500'],
        text=True
    )
```

Pros: real persistent conversation, same UX as the user typing in a terminal. The user CAN have multi-turn dialogue with Hermes and the history survives within the session. Works on Windows git-bash (tmux is shipped with Git for Windows).
Cons: requires tmux on the host. `capture-pane` output contains ANSI escape codes — strip them before sending to the frontend. tmux on Windows is sometimes missing in non-git-bash environments.

### Shape C — webhook trigger (async, fire-and-forget)

```bash
# 1. Start gateway (one-time)
hermes gateway install
hermes gateway start

# 2. Subscribe a webhook (one-time)
hermes webhook subscribe zs-task \
  --prompt-template "用户从前端下达需求: {{requirement}}。目标模块: {{module}}。请按 zs-dev-orchestrator 9 阶段流程处理,所有产物落到 {{project_path}},状态机写到 {{project_path}}/.meta-dev/state.yaml。完成后请回复 'DONE'。"

# 3. Trigger from Bridge (or frontend)
curl -X POST http://localhost:8000/webhooks/zs-task \
  -H "Content-Type: application/json" \
  -d '{"requirement":"做个 WS 状态指示器","module":"tongyu-frontend","project_path":"D:/InspurCode/AI-competition"}'
```

Pros: fully decoupled, no tmux. Standard `requests.post` from any language.
Cons: each webhook invocation starts a fresh conversation, no follow-up dialogue, no in-context memory within the invocation. Same limitation as Shape A but without the timeout penalty.

### Recommended combination: Shape B + Shape C

The user almost always wants the same Hermes session to handle both ad-hoc dialogue (Shape B) AND external triggers (Shape C). The pattern:

- **Always-on tmux session** (`hermes-dev`) — the user can attach at any time with `tmux attach -t hermes-dev`, AND the Bridge uses `tmux send-keys` for frontend-triggered tasks
- **Webhook as fallback** — if tmux is not running (the user closed their git-bash window), webhooks still let the frontend queue tasks for the next Hermes start

This is also the answer to the user's "can the session keep its chat history?" question:

| Scenario | History preserved? |
|---|---|
| Within a single tmux session (frontend or user keeps talking) | **Yes** — same as typing in a terminal |
| After Hermes restart (next morning) | **No** — only memory (auto-injected) + on-disk artifacts (state.yaml / specs / tests) survive |
| Multiple `chat -q` calls | **No** — each is a new session |
| Multiple webhook triggers | **No** — each is a new session |

The reliable answer to "keep history" is **Shape B (tmux)**. Webhook and `chat -q` are fine for "submit task, get result, forget."

---

## CRITICAL MISCONCEPTION — do NOT recommend `hermes mcp serve` for this

This was a first-class pitfall hit in the 2026-08-11 session: the agent confidently recommended `hermes mcp serve` as the way for the frontend to invoke Hermes, and the user had to push back ("你再好好看看自己的文档"). The truth, from `agent/transports/hermes_tools_mcp_server.py` (lines 1-43 of the module docstring):

> **Hermes-tools-as-MCP server for the codex_app_server runtime.** When the user runs `openai/*` turns through the codex app-server, codex owns the loop and builds its own tool list. By default, that means Hermes' richer tool surface — web search, browser automation, **delegate_task subagents, vision analysis, persistent memory, skills, cross-session search, image generation, TTS — is unreachable**. This module exposes a curated subset of those Hermes tools to the spawned codex subprocess via stdio MCP.

The 23 tools exposed by `hermes mcp serve` are:

```
web_search, web_extract, browser_navigate, browser_click, browser_type,
browser_press, browser_snapshot, browser_scroll, browser_back,
browser_get_images, browser_console, browser_vision, vision_analyze,
image_generate, skill_view, skills_list, text_to_speech,
kanban_complete, kanban_block, kanban_comment, kanban_heartbeat,
kanban_show, kanban_list, kanban_create, kanban_unblock, kanban_link
```

The tools **NOT** exposed (and explicitly named as "stateless MCP callbacks can't drive them"):

```
terminal, shell, read_file, write_file, patch, search_files, process,
delegate_task, memory, session_search, todo, clarify
```

The tools needed for "frontend invokes zsdev to run a pipeline" are **all in the NOT-exposed list**: `terminal` (to spawn CC), `write_file`/`patch` (to write specs), `delegate_task` (to dispatch CC subagents). So `hermes mcp serve` literally cannot do this job — even if the MCP install issue were solved, the tool surface would still be wrong.

When the user says "connect my frontend to Hermes", the right answer is Shapes A/B/C above, NOT MCP. **Verify the source file before recommending** (the file path above is in the bundled `hermes-agent` skill — `references/native-mcp.md` covers the client side but is silent on the server's actual scope).

### Side issue — `mcp` package not found when launching `hermes mcp serve`

Even if you wanted to use `hermes mcp serve`, on this user's setup (`D:/Users/isaac/miniconda3/python.exe` 3.13.5, hermes 0.16.0) the launch fails with `Error: MCP server requires the 'mcp' package`. The user has `mcp` installed in `D:/Users/isaac/miniconda3/Lib/site-packages/mcp/` (importable via the base conda python), but the hermes.exe frozen interpreter does not see it. Two possible fixes — neither tested in the session, both flagged as low priority since the use case was abandoned:

1. `hermes mcp install <catalog-mcp>` — may install into hermes's bundled site-packages
2. Force `PYTHONPATH=D:/Users/isaac/miniconda3/Lib/site-packages` in the env that launches hermes

If a future session needs MCP-server-on-Hermes, treat the install as a separate work item, do not assume the conda pip install carries over.