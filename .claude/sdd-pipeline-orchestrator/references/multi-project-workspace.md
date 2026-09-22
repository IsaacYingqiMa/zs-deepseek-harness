# Multi-project workspace layout for zsdev + TONGYU Bridge

The user runs multiple `.meta-dev/`-based SDD projects under `D:/InspurCode/` and wants one fixed home for the Bridge, frontend assets, shared scripts, and logs — while each project keeps its own `.meta-dev/` and specs/. This file documents the layout, the config file, and the manual startup recipes.

**Load this reference when**: the user asks to "set up the workspace", "where do I put the Bridge", "怎么管理多个项目", "start everything up", or any question about which directory contains what.

## Design principles

1. **One workspace, N projects**. Workspace is a single fixed sibling of all the project roots, never nested inside a specific project. Moving/renaming a project does not touch workspace.

2. **Projects own their `.meta-dev/`**. The supervisor writes to `<project>/.meta-dev/`, never to the workspace. Workspace only *watches* these directories via config — it doesn't own their lifecycle.

3. **Bridge is workspace-owned**. `tongyu-bridge/` lives under the workspace, not under any one project, because it monitors multiple projects simultaneously.

4. **Frontend can live in workspace or in project**. `tongyu-frontend` is currently inside `D:/InspurCode/AI-competition/` (existing setup, do not move). The workspace `config.yaml` references it by absolute path. Future projects can put their frontend anywhere — just declare the path.

5. **Logs and shared data under workspace**. `workspace/logs/`, `workspace/data/inbox/`, etc. are durable cross-project state.

## Recommended layout (user's setup as of 2026-08-11)

```
D:/InspurCode/
├── AI-competition/                          ← Project A: tongyu-frontend
│   ├── .meta-dev/                           ←   supervisor state (per-project)
│   ├── specs/
│   └── tongyu-frontend/                     ←   frontend lives here
├── migrate_agent/                           ← Project B: zdata-agent-starter
│   ├── .meta-dev/                           ←   supervisor state (per-project)
│   ├── CLAUDE.md
│   └── server.py
└── _tongyu-workspace/                       ← ✅ SINGLE FIXED WORKSPACE
    ├── tongyu-bridge/                       ←   Bridge source (git-trackable)
    │   ├── bridge.py                        ←   main service
    │   ├── pty_hermes.py                    ←   tmux wrapper (Shape B from zsdev-to-tongyu-bridge.md)
    │   ├── protocol.py                      ←   BattleEvent dataclasses
    │   ├── stage_event_map.yaml             ←   STAGE → BattleEvent translation
    │   ├── config.yaml                      ←   ⭐ multi-project declaration (see below)
    │   ├── __main__.py
    │   ├── tests/
    │   └── requirements.txt
    ├── data/                                ←   cross-project runtime data
    │   ├── ws-clients/                      ←     active WS connection log
    │   └── inbox/                           ←     webhook inbox queue (Shape C fallback)
    └── logs/
        ├── bridge.log
        └── hermes-dev.log                   ←   tmux `pipe-pane` capture of the Hermes session
```

`_tongyu-workspace/` is the single directory the user creates once and never moves. Everything related to "running the monitoring stack" lives here.

## config.yaml (the source of truth for what Bridge watches)

```yaml
version: "1.0"

server:
  ws_port: 8765         # frontend BattleEvent push
  http_port: 8766       # frontend COMMAND submission + health check
  host: "0.0.0.0"

projects:
  - id: "ai-competition"
    name: "AI 大赛统驭前端"
    path: "D:/InspurCode/AI-competition"
    meta_dev: "D:/InspurCode/AI-competition/.meta-dev"
    primary: true        # default project if frontend opens without ?project=

  - id: "migrate_agent"
    name: "zdata-agent-starter"
    path: "D:/InspurCode/migrate_agent"
    meta_dev: "D:/InspurCode/migrate_agent/.meta-dev"
    primary: false

  - id: "demo_agent"
    name: "AI 大赛演示智能体"
    path: "D:/浪潮文件/AI大赛/demo_agent"
    meta_dev: "D:/浪潮文件/AI大赛/demo_agent/.meta-dev"
    primary: false

hermes:
  tmux_session: "hermes-dev"
  startup_cmd: "hermes"
  default_workdir: "D:/InspurCode/AI-competition"

frontend:
  dev_command: "cd D:/InspurCode/AI-competition/tongyu-frontend && npm run dev"
  url: "http://localhost:5173"

notifications:
  feishu_chat_id: "oc_0180579c69b38b5ade3e51d7401edbf5"
  fallback: "log"  # log|feishu
```

The frontend opens `?project=ai-competition` (or whichever ID). Bridge parses the query param and watches only that project's `.meta-dev/`. Switching projects = reloading with a different `?project=`, no Bridge restart needed (Bridge watches all configured projects simultaneously anyway, the param is just a filter on the frontend side).

## Manual startup recipe (Windows git-bash)

The user wanted "把这个完整的方案告诉我" for how to actually launch everything. Three independent processes, three recipes.

### 1. Launch the Hermes tmux session

```bash
# One-time check: is the session already running?
if tmux has-session -t hermes-dev 2>/dev/null; then
  echo "hermes-dev already running, attaching..."
  tmux attach -t hermes-dev
else
  echo "Starting fresh hermes-dev session..."
  tmux new-session -d -s hermes-dev -x 120 -y 40 'hermes'
  sleep 8  # wait for Hermes to finish its startup banner
  echo "Session created. To attach:"
  echo "  tmux attach -t hermes-dev"
  echo "To detach from an attached session: Ctrl+B then D"
fi
```

Then in another terminal:
```bash
# Send a message
tmux send-keys -t hermes-dev "你好，请告诉我现在能做什么" Enter

# Wait and read reply
sleep 10
tmux capture-pane -t hermes-dev -p -S -50

# Optional: pipe-pane so all output goes to a log file too
tmux pipe-pane -t hermes-dev "cat >> D:/InspurCode/_tongyu-workspace/logs/hermes-dev.log"
```

### 2. Launch the Bridge

```bash
cd D:/InspurCode/_tongyu-workspace/tongyu-bridge
python -m venv .venv
.venv/Scripts/activate
pip install -r requirements.txt   # watchdog, websockets, pyyaml
python -m tongyu-bridge          # or `python bridge.py` if no __main__.py
```

### 3. Launch the frontend (dev server)

```bash
cd D:/InspurCode/AI-competition/tongyu-frontend
npm install   # first time only
npm run dev
```

Open `http://localhost:5173` in browser.

### One-shot launcher (recommended)

Put this at `D:/InspurCode/_tongyu-workspace/start_all.sh`:

```bash
#!/bin/bash
# start_all.sh — one-button launch of Bridge + Hermes + frontend
set -e

WS="D:/InspurCode/_tongyu-workspace"
PROJ="D:/InspurCode/AI-competition"

echo "🚀 启动 TONGYU 全栈..."

# 1. Hermes tmux session
if ! tmux has-session -t hermes-dev 2>/dev/null; then
  echo "  📟 启动 Hermes tmux 会话..."
  tmux new-session -d -s hermes-dev -x 120 -y 40 'hermes'
  sleep 5
fi
echo "  ✅ Hermes (tmux attach -t hermes-dev)"

# 2. Bridge
if ! ss -ln 2>/dev/null | grep -q ':8765 '; then
  echo "  🌉 启动 TONGYU Bridge..."
  cd "$WS/tongyu-bridge"
  source .venv/Scripts/activate 2>/dev/null || true
  nohup python bridge.py > "$WS/logs/bridge.log" 2>&1 &
  sleep 3
fi
echo "  ✅ Bridge (ws:8765 / http:8766)"

# 3. Frontend
if ! ss -ln 2>/dev/null | grep -q ':5173 '; then
  echo "  🖥️  启动 tongyu-frontend..."
  cd "$PROJ/tongyu-frontend"
  nohup npm run dev > "$WS/logs/frontend.log" 2>&1 &
  sleep 5
fi
echo "  ✅ Frontend (http://localhost:5173)"

echo ""
echo "🎉 全部就绪:"
echo "  - 前端:    http://localhost:5173"
echo "  - Bridge:  ws://localhost:8765"
echo "  - Hermes:  tmux attach -t hermes-dev"
```

Companion `stop_all.sh`:

```bash
#!/bin/bash
echo "Stopping TONGYU stack..."
tmux send-keys -t hermes-dev '/exit' Enter 2>/dev/null || true
sleep 2
tmux kill-session -t hermes-dev 2>/dev/null || true
# Find and kill Bridge
pkill -f 'python bridge.py' 2>/dev/null || true
# Find and kill Vite
pkill -f 'vite' 2>/dev/null || true
echo "Done."
```

**PowerShell equivalents** (`start_all.ps1`, `stop_all.ps1`) replace `tmux` with `Start-Process`/`Get-Process`, `grep` with `Select-String`, etc. The user typically runs git-bash on Windows, so .sh is sufficient for daily use; .ps1 is needed only if the user is in a PowerShell-only terminal.

## Common mistakes to avoid

- **Don't put `tongyu-bridge/` inside any one project** — it must live in the workspace, otherwise it can only see that project's `.meta-dev/`.
- **Don't hardcode project paths in Bridge code** — always read from `config.yaml`. New projects = new entry, no code change.
- **Don't use `nohup ... &` from inside the sandbox terminal** — the sandbox kills child processes when the call returns. Use the dedicated `terminal(background=true, notify_on_complete=true)` tool, or run the launcher from the host's git-bash, not from inside an interactive Hermes session.
- **Don't assume tmux is on Windows by default** — it ships with Git for Windows (git-bash), which the user does have. PowerShell users need a separate install. Detect with `which tmux` before recommending the tmux recipe.
- **Don't store `tongyu-bridge/.venv/` in git** — add `.venv/`, `__pycache__/`, `*.log` to `.gitignore`. Keep `requirements.txt` and `bridge.py` tracked.
- **Don't forget to set `VITE_USE_MOCK=false`** in the frontend when testing the real Bridge — otherwise the frontend plays its scripted 5-minute demo and never connects to ws:8765. Add `.env.local` next to `package.json`:
  ```
  VITE_USE_MOCK=false
  VITE_BRIDGE_HOST=localhost
  ```
- **Don't put Hermes workdir in workspace root** — set it to the project you'll be working on most. `tmux send-keys` works regardless of cwd, but `claude --workdir` (if you ever invoke CC from inside the session) needs the right path.

## Adding a new project

1. Edit `_tongyu-workspace/tongyu-bridge/config.yaml`, append a new entry under `projects:`
2. Ensure `<new_project>/.meta-dev/` exists (run zsdev once to initialize it, or copy a minimal `state.yaml` template)
3. Restart Bridge (`stop_all.sh && start_all.sh`, or just kill + relaunch the Bridge process)
4. Open frontend with `?project=<new_id>` to verify

No code changes needed.

## When NOT to use this workspace pattern

- **Single-project, throwaway prototype** — just run Bridge directly in the project root; the workspace is overkill.
- **Serverless deployment (Bridge in a Docker container)** — the workspace pattern assumes a long-lived host. Container deployments usually inline `config.yaml` and mount `.meta-dev/` volumes directly.
- **The user explicitly wants hermes to live inside a project** (rare, usually to keep `git` history clean) — fine, but the Bridge still goes in the workspace, not the project.