---
name: sdd-pipeline-orchestrator
description: "Orchestrate a multi-stage Spec-Driven Development (SDD) pipeline by dispatching one stage at a time to Claude Code (or similar coding agents), enforcing HARD-GATE checkpoints between stages, and persisting pipeline state. Use when the user has a defined stage sequence (e.g. zsspec-style: brain → spec → test-gen → verify → apply → code-review → e2e-gen → e2e-run → done) and wants Hermes to act as the supervisor/orchestrator — not as the implementer."
version: 0.2.0
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [SDD, spec-driven, pipeline, orchestration, Claude-Code, multi-stage, HARD-GATE, zsspec]
    related_skills: [claude-code, kanban-orchestrator, plan, requesting-code-review]
    absorbed_from: [zs-dev-orchestrator]
---

# SDD Pipeline Orchestrator

Supervise a multi-stage Spec-Driven Development pipeline by routing each stage to a coding agent (Claude Code by default) and enforcing HARD-GATEs between stages. This is the **supervisor role**, not the implementer role. Hermes stays outside the build loop; Claude Code does the actual coding.

## When to load this skill

Load when **all** of the following are true:

- The user has a defined stage sequence (e.g. zsspec's 14-skill suite, or any equivalent SDD pipeline with explicit stages and gates)
- The user wants **persistence** — close the session, reopen, resume from the right stage
- The user wants **enforcement** — stages must not bleed into each other; HARD-GATEs must be respected
- The user wants **delegation** — Hermes dispatches Claude Code per stage, not coding itself

Do **not** load for:

- One-shot coding tasks → use `claude-code` skill directly
- Cross-profile task routing across specialists → use `kanban-orchestrator`
- The user has no defined stage sequence → fall back to `plan` skill

## The HARD-GATE reality (load this first)

**The single most important property of an SDD pipeline is that humans decide at key checkpoints.** Every well-designed SDD skill suite (zsspec, spec-driven-dev, etc.) has explicit `<HARD-GATE>` blocks in its SKILL.md files that say things like:

- "未经用户明确确认,禁止进入下一阶段"
- "用户未明确允许,不得直接开始开发"
- "未完成 verify,不得直接进入 apply"

Those HARD-GATEs are written **for the implementer (Claude Code)**, not for the supervisor (Hermes). They tell the coding agent "do not skip past a decision that needs a human." The supervisor's job is to **stand in for the human** at most of those gates — not to refuse and forward every one.

### Two supervisor modes — ask the user which one they want

| Mode | When to use | Human touchpoints | What the supervisor does at each gate |
|------|-------------|-------------------|----------------------------------------|
| **Default ("advisor")** | User wants to stay in the loop, just not be typing prompts | 4-5/day, ~15s each | Name the conflict at the gate, propose the closest approximation, never pretend HARD-GATEs don't exist |
| **Authorized-proctor mode** | User explicitly says "you decide, only ping me at the start and end" | 2 total (kickoff + final acceptance) | The supervisor is the user's proxy at every HARD-GATE. It must still respect the gate's *spirit* (e.g. "verify must pass before apply") but it makes the call itself |

**The honest default is advisor mode.** If the user asks for "fully autonomous 24/7 with no human in the loop," the right response is to name the conflict directly: "Your skill files explicitly require human confirmation at these N gates. I cannot honestly promise 0 human involvement." Then offer advisor mode ("~1 minute/day") and authorized-proctor mode ("you write the rules, I enforce them, ping you at start + final accept only") as the two real options.

**Switch to authorized-proctor mode ONLY when the user has explicitly delegated.** Phrases like "你拍板就行", "你做我的替身", "I授权你", "just decide for me" are explicit delegations. Once delegated, the supervisor must enforce HARD-GATEs by *spirit* (e.g. verify must pass) but make the call by *self* (e.g. "this looks good enough, I'm approving and pushing forward"). The supervisor must NOT, in proctor mode, refuse to decide.

**Non-negotiable honesty in both modes:** the supervisor must never lie about what mode it is in. If a HARD-GATE says "user must confirm X" and the user has not delegated, the supervisor halts and asks — even in proctor mode. Delegation is per-stage, not blanket; the user can say "decide for me on brain/spec/done" and still want to be asked on apply range expansion.

## The 5 genuine human checkpoints (typical SDD) — and how each mode handles them

These are the gates where human judgment is structurally required. Reduce the rest to autonomous.

| # | Checkpoint | Stage it sits in | What the human decides | Advisor mode | Authorized-proctor mode |
|---|------------|------------------|------------------------|-------------|--------------------------|
| 1 | Post-brain | `zsspec-brain` | Scope / boundaries / non-goals are correct | Ask the human | Supervisor applies the SDD rules, decides "good enough" |
| 2 | Post-spec | `zsspec-spec` | Design and task breakdown are accepted | Ask the human | Supervisor dispatches `zsspec-verify`; if "可开工", proceeds; if "暂不可开工", sends CC to revise and re-verifies; only escalates after 3 failed revisions |
| 3 | Mid-apply range check | `zsspec-apply` | Whether scope expansion is allowed or refused | Ask the human | Supervisor runs `zsspec-change` classification. "小范围" / "spec 补充" / "Bug 修复(小)" → revise and continue. "重大变更" → supervisor makes a judgment call using the existing module's track record; if the same module has already rolled back to brain 2+ times in this run, escalate |
| 4 | Major change classification | `zsspec-change` | Whether to roll back to brain or proceed with patch | Ask the human | Supervisor classifies by the project's existing change rules and proceeds. Only escalates if classification is genuinely ambiguous (rare) |
| 5 | Final acceptance | `zsspec-done` | Ship / no-ship | Ask the human | Supervisor runs `zsspec-done`; if all gates pass (TASK closed, CHK static/auto/manual closed, evidence present, no blockers), updates REQ to "已完成" and pings the user with a summary. The user can still reject after the fact via `zsspec-change` |

Everything else (test-gen, verify, code-review, e2e-gen, e2e-run, intra-stage status writes) can run autonomously in both modes.

**The escalation ladder for proctor mode** — only these things ever escape to the human in proctor mode, and only after the supervisor has already tried and failed:

1. Same stage failed 3 consecutive times after re-dispatch
2. Same module rolled back to brain 2+ times in the same pipeline run (suggests the requirements are themselves broken)
3. Architecture drift that the supervisor cannot resolve against the project's first-principles document (e.g. CC proposes to use Redis for sessions in a JWT-only project, and the project's `01-architecture.md` is silent on the rule)
4. CC introduces a new dependency with security/performance implications the supervisor cannot evaluate
5. The user explicitly reserved a specific stage as "ask me" even in proctor mode

Pitfall: do not interpret "you decide" as a license to ignore HARD-GATEs entirely. The HARD-GATEs encode the project's quality bar. In proctor mode the supervisor enforces the bar; the difference is who makes the call, not whether the bar exists.

## Architecture (the working shape)

```
┌──────────────────────────────────────────────────────────────┐
│  Human                                                       │
│    ↑ 4-5 confirmations/day via Telegram/gateway or IDE      │
│    ↓ Initial requirements + final acceptance                 │
├──────────────────────────────────────────────────────────────┤
│  Hermes (this skill loaded)                                  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ State machine: stage transitions + checkpoints         │  │
│  │  - one YAML per module: current_stage, blocked_at,     │  │
│  │    artifacts[], next_action                            │  │
│  │  - persists in HERMES_HOME/state/sdd/<module>.yaml    │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ Handoff packer: assembles the per-stage prompt         │  │
│  │  - current module path                                 │  │
│  │  - target stage name + that stage's SKILL.md (inlined) │  │
│  │  - artifacts from prior stages                        │  │
│  │  - known failure modes (from memory)                  │  │
│  │  - hard constraints (from project CLAUDE.md)         │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │ Stage result validator: did Claude Code actually      │  │
│  │  - produce the expected artifact?                     │  │
│  │  - update the required status field?                  │  │
│  │  - respect the HARD-GATEs?                            │  │
│  │  Failure → re-dispatch with the gap as feedback       │  │
│  └────────────────────────────────────────────────────────┘  │
│  Delegate to Claude Code (claude -p, see claude-code skill) │
├──────────────────────────────────────────────────────────────┤
│  Claude Code (one process per stage)                         │
│  - reads handoff pack                                        │
│  - executes the single stage                                 │
│  - writes artifacts to specs/ + src/ + state/                │
│  - exits (print mode, --max-turns, --max-budget-usd)         │
└──────────────────────────────────────────────────────────────┘
```

## Pipeline state file (persistence contract)

Each module under development gets a YAML file at `HERMES_HOME/state/sdd/<module>.yaml`:

```yaml
module: "知识管理-RAG对话"
stages_completed: [brain, spec, test-gen, verify, apply, code-review, e2e-gen]
current_stage: e2e-run
stage_artifacts:
  brain:    "specs/.../BRAIN-...md"   # or "对话中" if not file-backed
  spec:     ["specs/requirement/.../REQ-...md", "specs/design/.../DES-...-前端.md", ...]
  verify:   "verify report at specs/.../verify-report-2026-06-17.md"
  apply:    "commits abc123..def456 on branch feature/rag-vector-update"
human_checkpoints_passed: [post_brain, post_spec]
human_checkpoints_pending: []
last_run: 2026-06-17T15:43:00Z
last_failure: null
next_action: "Dispatch e2e-run for module 知识管理-RAG对话"
```

This file is the single source of truth. On session resume, the supervisor reads it and knows exactly where to pick up.

## Dispatching one stage (the actual loop)

1. **Read state file** for the target module
2. **Identify the current stage** and its SKILL.md
3. **Pack the handoff**:
   - Stage name + inline the relevant SKILL.md body
   - Project CLAUDE.md content (hard constraints)
   - Paths to all prior stage artifacts
   - Known failure modes from memory (if any)
   - Explicit "you may not exit until X is written" instruction
4. **Dispatch** via `claude -p <handoff> --allowedTools "Read,Edit,Write,Bash" --max-turns N --max-budget-usd M` with `workdir` set to project root
5. **Validate the result**:
   - Did the expected artifact file appear?
   - Did required status fields get written (e.g. TASK states, CHK items)?
   - Did Claude Code respect the HARD-GATEs (e.g. did it stop and ask for confirmation when the spec said it must)?
6. **Update state file** with the new stage + artifacts + any failure log
7. **If human checkpoint reached** → push notification, halt further dispatch until user confirms
8. **If failure** → re-dispatch with the gap as feedback (max 2 retries; after that, escalate)

## Handoff pack template

```text
PROJECT: <project path from workdir>
MODULE: <module name>
CURRENT_STAGE: <stage name>
STAGE_SKILL: <inlined body of the stage's SKILL.md>

PRIOR_ARTIFACTS:
  - <path>: <1-line summary of what's in it>

HARD_CONSTRAINTS (from project CLAUDE.md):
  - <bullet>
  - <bullet>

KNOWN_FAILURE_MODES (from supervisor memory):
  - <bullet>
  - <bullet>

WHAT TO PRODUCE:
  - <file path> — <what should be in it>
  - <file path> — <what should be in it>

STATUS_WRITES_REQUIRED:
  - <file> field <field> should become <expected value>
  (e.g. "TASK-...md task status should be 已完成")

HARD_GATES TO RESPECT:
  - <the gate's text, copied verbatim from SKILL.md>
  - If you hit a HARD-GATE, STOP and report the gate's reason verbatim
    back to the supervisor. Do not proceed past it.

EXIT_CRITERIA: <one-line "done" definition>
MAX_TURNS: <n>     MAX_BUDGET_USD: <n>
```

## Pitfalls

1. **Do not code yourself.** This skill is supervisor-only. If you start "just fixing this small thing" you have stopped being a supervisor and started being a coder. Re-delegate.

2. **Do not skip the validation step.** Claude Code in `-p` mode will return a result even if it failed silently. Always check the artifact file exists, the status field was written, and the HARD-GATEs were respected before advancing the state machine.

3. **Do not bypass HARD-GATEs in the handoff.** If the stage SKILL.md says "must wait for human confirmation before X," the handoff must include that text verbatim. Stripping HARD-GATEs to "make things go faster" is the supervisor lying to itself.

4. **Do not over-batch stages.** One stage per dispatch. Multi-stage handoffs are tempting (saves tokens) but they break the validation step and the human checkpoint model. The cost of one dispatch is small relative to the cost of a stage bleeding into the next.

5. **Do not promise 0 human involvement.** See "The HARD-GATE reality" above. The honest pitch is "4-5 confirmations/day, ~15 seconds each." If the user insists on 0, refuse clearly and explain why.

6. **Do not couple the state file to a specific agent.** The state file is the supervisor's contract with itself. Whether the implementer is Claude Code, Codex, or a future agent, the state file stays the same. Resist the temptation to store agent-specific IDs (session_id, etc.) in the persistent state.

7. **Do not re-dispatch a failed stage more than twice without escalating.** If two retries with feedback don't fix it, the failure is structural (bad spec, missing prerequisite, HARD-GATE conflict) and the human needs to look.

8. **Budget per dispatch matters.** Set `--max-budget-usd` low enough that a runaway stage can't burn the whole project budget before the supervisor notices. Typical per-stage cap: $0.50-$2.00 depending on stage complexity.

9. **Notify on checkpoint, not on progress.** Don't spam the human with "I'm 30% through e2e-run." Notify when there's an actual decision to make.

10. **State file writes must be atomic.** Supervisor updates the YAML only after the stage result is validated. If the dispatch crashes mid-flight, the state file still says "stage X in progress, last good state was Y" — so the next session resumes safely.

11. **In authorized-proctor mode, do not over-escalate.** The user has explicitly delegated the 5 default checkpoints. Escalating at every "I'm not 100% sure" moment defeats the whole purpose. Escalate only on the 5 hard triggers listed above (3 retries, 2 brain rollbacks, ambiguous architecture drift, unverifiable new dependency, explicit reservation). For everything else, the supervisor's job is to decide and move on, then surface the decision in the final-acceptance summary.

12. **Always cross-check the project's first-principles document, not just the SDD suite's HARD-GATEs.** The SDD skill's HARD-GATEs describe *workflow* gates. The project's `01-architecture.md` / `CLAUDE.md` describe *substance* constraints (e.g. "this project uses JWT, not sessions"; "vector search must go through Milvus"; "no new dependencies without PR justification"). Architecture-drift detection at the apply and code-review stages is what separates a real supervisor from a stage-walker. The supervisor must read the project's first-principles document on every apply dispatch and verify CC's diff against it.

13. **Phase 0 — clarify before orchestrating on a new project.** When the user names a project you have not orchestrated against before, do **not** start dispatching. Run a short Phase 0: (a) list the project's SDD skills recursively — empty-looking top-level directories can hide populated subtrees (see pitfall 14); (b) read the architecture document and one representative spec end-to-end; (c) surface the unanswered questions (input/output contract, triggering API path, branch conditions, naming conventions) and ask the user to confirm before writing the first handoff. The user explicitly said this session: "不要直接开始orchestration...请你问清楚我之后编排好" — taking the first run as a "test" usually burns time on a spec the user would have corrected in two minutes.

14. **Verify directory contents recursively before claiming "empty" or "missing".** A non-recursive `ls` on a parent directory will mislead you when the children are populated. Concrete failure seen in production: ran `ls .claude/skills/` and saw the top-level empty, concluded "no zsspec skills in this project," and reported that to the user. The directory actually contained 12 zsspec-* subdirectories each with its own `SKILL.md`. Fix: any time you need to assert "this thing exists" or "this thing is missing," use `find <path> -name <pattern>` or `ls -R`. The recursive check is a 1-second cost; the wrong conclusion costs a full user correction cycle.

29. **When the user says "现在路径下面" or "我的前端" or "我的项目", do NOT guess among historical memory paths.** A session in 2026-08 had the user say "现在路径下面这个前端" and the agent guessed between two paths from prior session memory (`D:/InspurCode/migrate_agent` and `D:/浪潮文件/AI大赛/demo_agent`). Both were wrong; the actual project was a third path entirely (`D:/InspurCode/AI-competition/tongyu-frontend`). Memory records historical state, not current state. Fix: at the start of any session that references "现在/当前/我的 X", run `ls $HOME` or check the actual `cwd` and recent disk activity before answering. A 5-second `ls -la` on the parent directory beats a 30-minute wrong-path investigation. Memory's role is to remember what you've confirmed exists, not to anchor you to a guess.

25. **For complex input data files (JSON/YAML DSL, large flow definitions, configs > 10KB), do a structural read first, not a free-form scan.** Examples: a Bisheng flow JSON with 25 nodes / 24 edges / 5 LLM stages cannot be summarized by reading the first 80 lines — you'll misstate the topology. Pattern: write a small Python script that walks the file structurally (count nodes by type, dump edges, extract each node's name + key params + outgoing connections) before responding to the user. This is what the supervisor's job is at Phase 0 anyway — you need the structural map to ask the right clarifying questions.

30. **Verify tool/platform claims BEFORE recommending them, especially when the user is a senior architect who will catch hallucinated facts immediately.** In the 2026-08-11 session, the agent confidently recommended `hermes mcp serve` as the way to let the frontend trigger Hermes. The user pushed back ("你再好好看看自己的文档"), and only then did the agent read `agent/transports/hermes_tools_mcp_server.py` and discover that `hermes mcp serve` is a Codex tool-bridge exposing only 23 specific tools (no `delegate_task`/`terminal`/`write_file`) — unusable for the use case. The fix is procedural, not skill-content: any time the agent is about to recommend a specific command, API, or feature, **first run it (or `grep` the source) to confirm the recommendation is grounded**. The user signals this risk class with phrases like "再好好看看自己的文档", "你能确认一下吗", "你先实际跑一下试试". A 30-second verification beats a 10-minute user correction cycle. This applies equally to API endpoints, flag combinations, config schema, and "obvious" tool names — assume your memory could be stale.

31. **Do NOT recommend `hermes mcp serve` for "let the UI/frontend invoke Hermes to run a pipeline".** This is a special case of pitfall 30 that warrants its own pitfall because the agent's instinct is to reach for it whenever MCP comes up. `hermes mcp serve` (`agent/transports/hermes_tools_mcp_server.py`) is designed to expose Hermes's tool surface to the Codex CLI runtime so that Codex (which owns its own loop) can call web_search / browser_* / vision_analyze / kanban_* tools. It deliberately does NOT expose `terminal`, `read_file`, `write_file`, `delegate_task`, `memory`, `session_search`, or `clarify` — the tools a frontend → "run zs-dev pipeline" flow actually needs. The correct shapes for that flow are: (a) `hermes chat -q` one-shot (no persistence, no dialogue), (b) tmux long session + `tmux send-keys` (persistence, dialogue, Windows git-bash compatible), (c) `hermes webhook subscribe` + HTTP POST (fire-and-forget). See `references/zsdev-to-tongyu-bridge.md` §"Reverse direction" for the full recipe and the history-preservation table. Also note: `hermes mcp serve` may fail to find the `mcp` package even when `pip install mcp` succeeds (frozen hermes.exe site-packages vs conda site-packages path mismatch); treat the install as a separate work item if needed.

26. **Mock-based pytest passing does NOT prove real LLM/framework integration works.** A 37/37 pytest pass with all LLM calls mocked is necessary but not sufficient. Concretely, observed in 2026-07-30 business_card_scanner v2: pytest 37/37 with `mock.patch.object(agent.run, return_value=...)` did not catch that Agno 2.6.5's `agent.run(images=[...])` requires `agno.media.Image` objects (with `.id` attribute), not raw strings or data URLs. The mock absorbs the call, so the test never exercises Agno's actual `images=` validation. The bug surfaced only when the supervisor started `server.py` for real and curled the endpoint — `AttributeError: 'str' object has no attribute 'id'`, HTTP 502. **Mitigation**: at stage 10 (done), before declaring the module "ready for user acceptance", do a **minimum real-integration smoke**: start the actual server process, send 1 real request to the new endpoint, observe 1 real LLM call (log/timing), and verify the HTTP response status. This adds ~60s to a 30-minute module but catches a whole class of "mocked-passing, real-failing" bugs. See `references/real-integration-smoke.md` for the recipe.

27. **Agno 2.6.5 vision integration: `images=` kwarg requires `agno.media.Image` objects, not strings.** Observed in 2026-07-30 business_card_scanner v2: `agent.run(prompt, images=["data:image/jpeg;base64,..."])` raises `AttributeError: 'str' object has no attribute 'id'`. Agno validates each `images=` element has `.id` (from `agno.media.Image` Pydantic model). You MUST convert inputs to `agno.media.Image(content=bytes, mime_type="image/jpeg")` before passing. The conversion accepts three input forms: (a) raw `PIL.Image.Image` (use `BytesIO` + `save`), (b) data URL string `"data:image/jpeg;base64,..."` (split + base64 decode), (c) file path string (load + pass as `filepath`). See `references/agno-2.6-vision-integration.md` for the full `_to_agno_image()` template and a working wrapper.

28. **Hermes `write_file` tool's workspace resolve can mangle POSIX-style paths in CWD.** Observed in 2026-07-30 session: writing to `path="/d/浪潮文件/AI大赛/demo_agent/.meta-dev/profile.yaml"` (forward-slash `/d/...` MSYS-style path) produced a `resolved_path` of `D:\d\浪潮文件\AI大赛\demo_agent\.meta-dev\profile.yaml` — note the extra `\d\` segment, which creates a non-existent directory. Subsequent `ls .meta-dev/` showed no yaml files because they had been written to the wrong tree. The fix is to pass the path as a **Windows-style absolute path with backslashes**: `path="D:\浪潮文件\AI大赛\demo_agent\.meta-dev\profile.yaml"`. Then `resolved_path` matches the project root exactly. The warning `_warning: Relative path ... resolved to ... OUTSIDE the active workspace` is the diagnostic — if it fires, your path is wrong. Quick check pattern: after `write_file` on a path you care about, immediately `ls` (or `search_files pattern=<filename> path=<parent>`) the expected parent directory and confirm the file shows up. If it doesn't, the resolve went wrong; do not trust CC's report-back.

16. **Claude Code's `Read` tool silently truncates large files.** Observed in the 2026-06-18 migrate_agent session: when CC used `Read` to load the 55KB Bisheng JSON for the brain stage, three of the ten `code` node function bodies came back with the tail clipped (2342→1774 chars, 1440→304 chars, 1439→304 chars). CC did not notice the truncation and reported "done." Fix: any time the handoff needs literal byte-for-byte content from a large file (DSL `code_body`, embedded templates, raw prompts), **inline the content directly into the handoff prompt** instead of asking CC to read the file. Reserve CC's `Read` tool for files that CC can summarize freely (CLAUDE.md, architecture docs, prior spec artifacts). Byte-exact verification afterward is still required — CC's `Edit` and `Write` tools can also drop content if their context is full.

17. **Claude Code defaults to "补全式发挥" (auto-improve mode) for code.** When asked to "write this function" or "transcribe this code", CC will silently rewrite, simplify, or extend the source to match its own understanding of what the function "should" do. Observed: CC replaced a Bisheng `html_input_transform` that uses `p.name = 'para'` rewriting + `find_all(['para','header'])` extraction with a CC-invented `find_all(['p','div','section','article','li'])` + `get_text(strip=True)` version — same intent, completely different code, breaks the contract. Fix: when the handoff demands byte-exact reproduction, the prompt must say **"字符级 1:1 翻译"** (character-level 1:1 translation) explicitly, and the supervisor must run a post-dispatch byte-diff between the source-of-truth file and CC's output, rejecting any non-zero diff.

18. **CRLF vs LF matters when embedding source code from JSON DSLs.** The 2026-06-18 Bisheng JSON had `code_body` fields stored as CRLF (`\r\n`). When Python's `str.replace('\\n', '\n')` decoded the JSON, CRLF collapsed to LF. CC's output then used LF. The byte-exact diff passed on the first 200 chars but failed on the line endings, marking 5/10 code blocks as "deviated." Fix: when extracting `code_body` (or any embedded source) from a JSON DSL for byte-exact reproduction, write the target file with `Path.write_bytes(content.encode('utf-8'))` (not `write_text`) so Python does not auto-normalize line endings on Windows. For Linux/macOS, the default LF is fine; the issue is Windows-only.

19. **Verify CC output with a Python byte-diff script, not by reading CC's report-back.** CC in `-p` mode will print "all 6 files written, 357 lines, 10 code blocks" and be factually wrong about every numeric claim. The supervisor must:
    - (a) `stat` the file to confirm size > 0
    - (b) re-read the file with `read_file` and use a Python `re.findall` to extract all ` ```python ... ``` ` blocks
    - (c) compare each block to the expected source using `==` (not `in`, not `startswith`) — `==` is the only honest equality test
    - (d) reject on any non-equal block
    This script runs in ~0.5s and catches every silent truncation, every CRLF collapse, and every "auto-improve" rewrite in one pass. A reference implementation is at `scripts/verify_byte_exact_blocks.py` — call it with `--doc <md path> --source <json dsl> --node-key code --code-field code` and check the exit code.

20. **Hermes's native `delegate_task` (vs `terminal` + `claude -p`) is not reliable for non-trivial CC work in the default sandbox.** Observed 2026-06-18: `delegate_task` (Hermes's subagent spawner) timed out at ~30s for both the brain-stage dispatch and a rewind attempt. The fix is to dispatch CC directly via the `terminal` tool using the pattern documented in `claude-code` skill: `terminal(command="claude -p '<handoff>' --allowedTools 'Read,Write,Edit' --max-turns <N> --workdir <project>", timeout=300)`. Recommended `--max-turns`: 6-10 for spec/doc stages, 10-15 for apply/code stages, never set `--max-turns 1` (CC needs room to read → think → write → re-verify). The handoff pack template at `templates/handoff-pack.md` is directly usable as the prompt body; pass it as a single-quoted heredoc or as the value of the `claude -p` argument. Set terminal `timeout` to 300+ seconds; CC startup alone takes 5-10s, then the work.

21. **Long CC dispatches (>600s) must use `background=true` + workspace-relative prompt path, not `/tmp/`.** The Hermes `terminal` foreground cap is 600s; any stage that predictably needs 8-12 minutes (full apply, code-review across a 30+ file diff, multi-spec change) must run in background. But `/tmp/` paths written in one terminal call are NOT visible to a later background subprocess — `/tmp/` is shell-isolated and gets wiped. The reliable pattern: (1) write the prompt to a stable workspace path (e.g. `.meta-dev/cc-deliveries/_<stage>_prompt.txt`), (2) dispatch with `background=True, notify_on_complete=True, timeout=1800`, (3) pipe the prompt via `cat <path> | claude --print -` (the `-` tells `--print` to read from stdin). See `references/cc-dispatch-quirks.md` §1-2 for the full recipe and the diagnostic for the 600s vs 1800s vs 60s cap confusion. `process.wait` / `process.poll` are clamped to 60s — loop them, or use `notify_on_complete=true` for the actual finish signal.

22. **When CC hits `--max-turns`, the code files exist but the status-table appends don't.** The synchronous `Write` calls in CC's last turns committed to disk before the agent loop noticed the budget was gone. Recover with a 5-15 turn "补完 patch" dispatch: a tiny focused prompt that reads nothing new, just appends the 1 status table / version bump / CHK回写 the main stage was supposed to do. Total wall time 1-2 minutes; saves a 30+ minute state-machine recovery. Pattern documented in `references/cc-dispatch-quirks.md` §3. Complements the "接力 CC" pattern in `references/cc-delivery-v2-deltas-zs.md` — that file covers the generic接力 case (continuation of work-in-progress), this one covers the specific补完 case (status writes the main stage ran out of turns to do).

23. **zsspec-e2e-gen SKILL.md is 100% Playwright — for Python backend projects, document the pytest adaptation in `project-profile.yaml` BEFORE stage 8.** Otherwise CC pattern-matches the skill template and produces a Playwright config + 0 runnable tests. The fix is one block of YAML in `project-profile.yaml` (see `references/cc-dispatch-quirks.md` §4 for the exact key-value) plus an explicit reminder in the stage-8 handoff. Same logic applies to e2e-run: `pytest` replaces `npx playwright test`. CHK documents themselves stay in zsspec standard format — only the artifact form changes.

24. **Python `workflow/__init__.py` auto-imports trigger transitive deps in tests.** When a project's top-level package `__init__.py` does `from .engine import *` and the engine imports `agno_agent.components.memory` (which transitively imports `mem0ai` or other heavy deps), every test that does `from workflow.<anything> import ...` sees `ImportError: mem0ai package not found` even when the test has nothing to do with memory. Fix at the top of `tests/conftest.py` (runs before any test collection): `sys.modules["agno_agent.components.memory"] = MagicMock()`. The mock lives only in the test process; production imports stay intact. Do NOT put a `try/except ImportError` in `workflow/__init__.py` — that would silently swallow a real production failure.

## Reference: zsspec stage map (canonical SDD example)

If the user has the zsspec skill suite, the canonical stage sequence is:

```
init → brain → spec → test-gen → verify → apply → code-review
                                                       ↓
                                            e2e-gen → e2e-run → done
                          ↑                              ↑
                          └────── change (anywhere) ─────┘
```

| Stage | Skill | Human checkpoint? | Produces |
|-------|-------|-------------------|----------|
| init | `zsspec-init` | no | `CLAUDE.md`, `specs/design/01-*.md` |
| brain | `zsspec-brain` | yes (post) | Structured discussion conclusion |
| spec | `zsspec-spec` | yes (post) | REQ / DES-前端 / DES-后端 / TASK |
| test-gen | `zsspec-test-gen` | no | CHK with `automation=static/auto/manual` |
| verify | `zsspec-verify` | no | Go/no-go for apply |
| apply | `zsspec-apply` | yes (mid, on scope expansion) | Code + TASK status writes |
| code-review | `zsspec-code-review` | no | CHK static items status writes |
| e2e-gen | `zsspec-e2e-gen` | no | Playwright test code |
| e2e-run | `zsspec-e2e-run` | no | CHK auto items status writes + report |
| done | `zsspec-done` | yes (final) | REQ status → 已完成, or rollback |
| change | `zsspec-change` | conditional | Doc + code revisions |

Other SDD suites follow the same shape with different names. The supervisor's job is the same: walk the state machine, respect the gates, persist between sessions.

## Support files

- `templates/handoff-pack.md` — the per-stage Claude Code dispatch template (copy, fill, pass as prompt)
- `templates/module-state.yaml` — the per-module persistence file (one per module, atomic write contract)
- `references/zsspec-stage-map.md` — concrete zsspec 14-skill stage map with HARD-GATE locations and human checkpoint callouts
- `references/zkproject-first-principles.md` — zk-project (Bisheng) architecture / NFR / spec-system / failure-mode seed; load when orchestrating against `D:\InspurCode\zk-project`
- `references/migrate-agent-first-principles.md` — zdata-agent-starter (Agno multi-agent framework) architecture / module layout / planner-workflow-engine plan; load when orchestrating against `D:\InspurCode\migrate_agent`
- `references/tongyu-frontend-first-principles.md` — AI-competition `tongyu-frontend` (统驭 / AI研发作战指挥中心) sand-table workstation map architecture, station IDs, agent IDs, BattleEvent schema; load when orchestrating against `D:\InspurCode\AI-competition` or when the user mentions "tongyu", "工位地图", or "TONGYU Bridge"
- `references/zsdev-to-tongyu-bridge.md` — TONGYU Bridge implementation recipe (3-layer pattern: file watch → WebSocket → frontend); load when the user asks to "把 zsdev 真实状态推到 tongyu-frontend" or to "可视化 pipeline 状态". Also covers the **reverse direction** (UI → supervisor trigger via tmux / webhook / `chat -q`) and the **`hermes mcp serve` misconception** — `hermes mcp serve` is a Codex tool-bridge with deliberately limited tool surface (no `delegate_task`/`terminal`/`write_file`), do NOT recommend it for "let the frontend invoke Hermes".
- `references/multi-project-workspace.md` — fixed `_tongyu-workspace/` layout (Bridge + scripts + logs), multi-project `config.yaml`, and the manual startup recipes for Hermes tmux session + Bridge + frontend dev server (bash + PowerShell). Load when the user asks "怎么手动启动", "workspace 怎么管理", or "怎么区分每个项目的位置".
- `references/json-dsl-to-workflow-reproduction.md` — pattern for mapping a flow-style JSON DSL (Bisheng flow, n8n-style, similar) into a Python workflow + agents + utils; load when the user's task is "reproduce this JSON workflow as code in this framework"
- `references/cc-dispatch-quirks.md` — observed CC failure modes (silent Read truncation, "补全式发挥" code rewrites, CRLF collapse) and the inline-prompt + byte-diff verification pattern; load when dispatching CC for byte-exact reproduction tasks
- `scripts/verify_byte_exact_blocks.py` — runnable byte-exact verifier for CC output vs DSL source-of-truth (see pitfall 19)

### zs-dev-orchestrator personalization (中文, absorbed 2026-06)

The Chinese-language `zs-dev-orchestrator` skill was absorbed into this umbrella. It added three-layer architecture (intent-recognition / stage-orchestration / execution), project-profile-driven `.meta-dev/` state, and a richer Phase 0 (codebase orientation). Load these alongside the rest when orchestrating against the user's `D:\InspurCode\*` projects:

- `references/cc-delivery-chinese-zs.md` — Chinese-language CC dispatch deltas (max-turns calibration, sandbox timeout vs CC failure, CRLF handling, sandbox auto-block on heavy dispatches)
- `references/cc-delivery-v2-deltas-zs.md` — incremental patch from 2026-06-24 (document-level change max-turns table, relay-CC mode with version numbering, background CC notification handling, zk-project dispatch example)
- `references/codebase-orientation-zs.md` — Phase 0 methodology for reading an existing codebase before any new task (boundary scan → spec selection → code skeleton → cross-validation → map output)
- `references/intent-recognition-zs.md` — Layer 1 intent recognition rules + the 6 default route types (T1-T6)
- `templates/decision-table-zs.md` — 自主判定决策表 — when the supervisor decides vs when it escalates
- `templates/delegation-prompt-zs.md` — the 5-section CC dispatch prompt template (项目上下文 / 本 stage 目标 / 硬约束 / 必落盘路径 / 必返回 JSON)
- `templates/stage-definitions-zs.md` — 9-stage universal definitions (brain / spec / test-gen / verify / change / apply / code-review / e2e-gen / e2e-run / done)
- `templates/orientation-report-zs.template.md` — Phase 0 output template (现状地图)
- `templates/project-profile-zs.template.yaml` — `.meta-dev/project-profile.yaml` schema
- `templates/route-plan-zs.template.yaml` — `.meta-dev/route-plan.yaml` schema
- `templates/state-zs.template.yaml` — `.meta-dev/state.yaml` schema

The user-feedback corrections encoded here (terse test commands, no `--max-time` on curl, "don't stop" default mode, WeChat is one-way, rate-limit at 4/min) supersede the older self-contained instructions in this umbrella.

## Self-bootstrap: detect an SDD suite on the project

If the user has not told you their stage sequence, scan the project for the SDD skill suite before designing the pipeline:

1. Check `.claude/skills/` for `zsspec-*`, `spec-*`, `sdd-*`, `*-brain`, `*-spec`, `*-verify`, `*-apply`, `*-code-review` style skills
2. Read each SKILL.md's `<HARD-GATE>` blocks — these define the human checkpoints
3. Build the state machine by following the skill descriptions' "下一阶段" / "next stage" pointers
4. Map every HARD-GATE to a `human_checkpoints_*` entry in the module state file

If no SDD suite is present, this skill is not the right tool — fall back to `plan` or `claude-code` directly.

## What this skill does NOT do

- It does not write code (that's the implementer)
- It does not write specs (that's the implementer too, in stages brain/spec)
- It does not replace the project's own SDD skill suite — it orchestrates it
- It does not invent new gates; it enforces the gates the project's SKILL.md files already declare
- It does not pretend the human can be removed from the loop
