# Claude Code Dispatch Quirks (CC 在 print mode 下的暗坑)

Observed 2026-06-18 in the migrate_agent / 政策事项拆解 module session. Captured here so the next supervisor dispatching CC for byte-exact code reproduction doesn't get bitten.

## TL;DR

When CC is asked to byte-exact reproduce source code embedded in a JSON DSL (Bisheng flow, n8n export, etc.), three failure modes fire silently. The supervisor MUST:

1. **Inline the source code directly into the handoff prompt** — do not let CC use `Read` on the source DSL
2. **Add the phrase "字符级 1:1 翻译"** to the handoff — without it, CC auto-rewrites
3. **Run a byte-exact diff** after CC returns — see `scripts/verify_byte_exact_blocks.py`

## The three failure modes

### 1. Read tool silently truncates large files

`claude -p` CC's `Read` tool will load only a prefix of any file larger than ~1.5-2 KB. The truncation point is not announced; CC just sees a smaller-than-actual file and reports success.

**Concrete**: Asked CC to read `政策事项拆解.json` (55 KB) and transcribe 10 embedded `code_body` fields. CC delivered 10 code blocks — but three of them were truncated mid-function: 2342→1774 chars, 1440→304 chars, 1439→304 chars. CC did not notice.

**Fix**: Inline the content directly into the handoff prompt, OR have the supervisor pre-extract the relevant subset and pass it as a heredoc to `claude -p`. Don't rely on CC to "go read the DSL."

### 2. CC defaults to "补全式发挥" (auto-improve mode)

When told "write this function" or "transcribe this code", CC will silently rewrite, simplify, or extend the source to match its own model of what the function "should" do. It does not distinguish "transcribe" from "implement" by default.

**Concrete**: Bisheng `code_d309a (html输入转化)` actually uses `p.name = 'para'` to rename `<p>` tags, then `find_all(['para','header'])` to extract. CC "transcribed" it as `find_all(['p','div','section','article','li'])` + `get_text(strip=True)` — different code, same intent, breaks the byte-exact contract.

**Fix**: Explicit instruction in the handoff:

```
要求: 字符级 1:1 翻译 json 中的 code_body 字段,
绝对禁止改写、补全、简化任何代码。
```

Even with this, run a byte-diff after. The phrase reduces (does not eliminate) auto-improvement.

### 3. CRLF vs LF line-ending collapse

JSON DSLs often store multi-line code with `\r\n` (CRLF) line endings. When Python decodes the JSON and writes the code to a target file with `Path.write_text()`, Windows Python auto-normalizes to `\n` (LF). The file is "byte-exact" on Linux/macOS but fails a Windows byte-diff.

**Concrete**: 5 of 10 Bisheng code bodies used CRLF in `code_body`. After Python decode + write_text, they became LF. First byte-diff passed on first 200 chars (whitespace-insensitive) but failed on line endings, marking 5/10 as deviated.

**Fix**: Use `Path.write_bytes(content.encode('utf-8'))` instead of `write_text` when the source has CRLF and the target must be byte-exact. On Linux/macOS the issue doesn't appear (Python writes raw bytes either way); this is a Windows-only gotcha.

## The verification pattern

```python
import re
from pathlib import Path

# 1. Read CC's output as bytes (preserve CRLF)
doc = Path("path/to/cc_wrote.md").read_bytes().decode("utf-8")

# 2. Extract every ```python ... ``` block, in order
blocks = re.findall(r"```python\n(.*?)\n```", doc, re.DOTALL)

# 3. Compare each block to expected (== not in, not startswith)
import json
src = json.loads(Path("source.json").read_text(encoding="utf-8"))
expected_by_id = {}
for n in src["nodes"]:
    for gp in n.get("data", {}).get("group_params", []):
        for pi in gp.get("params", []):
            if pi.get("key") == "code":
                expected_by_id[n["id"]] = pi["value"]

all_ok = True
for nid, expected in expected_by_id.items():
    # ... pair with blocks in order ...
    if expected != actual_block:
        all_ok = False
        # find first divergence, print 30-char context on each side
```

`scripts/verify_byte_exact_blocks.py` is the runnable version of this script. Exit code 0 = pass, 1 = fail with deviations printed to stderr, 2 = setup error.

## When byte-exact does NOT matter

If the handoff says "summarize this file" or "extract the structure", CC's `Read` truncation is fine — the output is a summary, not a transcription. Reserve the inlining + byte-diff discipline for:

- DSL `code_body` reproduction
- LLM `system_prompt` / `user_prompt` verbatim copy
- Embedded config snippets (YAML/JSON in another YAML/JSON)
- Anything where the spec says "must match X verbatim"

For everything else, let CC `Read` freely and spot-check a sample.

## Transport-layer dispatch issues (2026-07-30 business_card_scanner session)

A separate class of failure has nothing to do with CC's content quality — it's the **transport pipe** between Hermes and the CC subprocess. These bit a real session and forced a rewind that took 30+ minutes to recover from. Captured here so future supervisors don't relearn them.

### 1. `/tmp/` paths are not portable across shell invocations in the sandbox

The Hermes `terminal` tool runs each command in a fresh git-bash / MSYS shell. Files written to `/tmp/...` from one `terminal` call are **not visible** to a later `terminal` call in a different `background=true` subprocess — `/tmp/` gets isolated or even wiped between shell instances.

**Symptom** (verbatim): the brain-stage prompt was written to `/tmp/cc_brain.txt` and dispatched with `claude --print "$(cat /tmp/cc_brain.txt)"` in a **foreground** terminal call. That worked. Then for the spec stage the supervisor switched to `background=true` + `notify_on_complete=true`, and CC immediately failed with:

```
cat: /tmp/cc_spec.txt: No such file or directory
Error: Input must be provided either through stdin or as a prompt argument when using --print
```

**Fix**: never pass the prompt via shell expansion of a `/tmp/` file. Either:

(a) **Inline the prompt** in the `claude -p "..."` argument directly (works for prompts < ~8KB; after that the bash command line gets ugly and may exceed the kernel's `ARG_MAX`).

(b) **Write the prompt to a stable workspace path** (e.g. `.meta-dev/cc-deliveries/_<stage>_prompt.txt` inside the project directory) and pipe it via stdin:

```bash
cat .meta-dev/cc-deliveries/_spec_prompt.txt | claude --print - --allowedTools "Read,Write,Edit,Glob,Grep,Bash" --max-turns 50
```

The `-` argument tells `claude --print` to read the prompt from stdin. The workspace path is guaranteed to exist for any later subprocess in the same session, because the project root is the supervisor's own working directory.

**Rule of thumb**: `/tmp/` for transient one-shot dispatch in foreground; **workspace-relative path** for any prompt that will be referenced from `background=true` or from a later terminal call.

### 2. Hermes `terminal` foreground timeout caps at 600s

`terminal(timeout=600)` is the documented maximum for foreground. Big stages (multi-file apply, full e2e-gen, code-review across a 30+ file diff) often need 8-12 minutes. Trying to dispatch them foreground returns:

```
Foreground timeout 600s exceeds the maximum of 600s. Use background=true with notify_on_complete=true for long-running commands.
```

**Pattern that works**:

```python
terminal(
    command="cat .meta-dev/cc-deliveries/_<stage>_prompt.txt | claude --print - --allowedTools '...' --max-turns <N>",
    background=True,
    notify_on_complete=True,
    timeout=1800,  # soft cap; the real cap is the process lifetime
)
```

Then poll:

```python
process(action="poll", session_id="...", timeout=60)  # 60s cap on poll
process(action="wait", session_id="...", timeout=60)  # 60s cap on wait
```

`process.wait` and `process.poll` are **clamped to 60s** by the platform. You can call them in a loop or rely on `notify_on_complete=true` for a real finish notification. **You cannot wait longer than 60s in a single `process` call** — that is the real constraint, not the underlying 1800s.

**`process.wait` returns the current stdout snapshot when the timeout elapses**, not a special "still running" sentinel. Distinguish "process is still running" from "process just hit the 60s ceiling" by checking the `status` field on the response.

### 3. CC's `Write` survives `max-turns` abort — but the status writes don't

When CC runs out of `--max-turns`, it exits with:

```
Error: Reached max turns (80)
exit_code: 0
```

But every `Write` call CC made **was synchronous and committed to disk** before the agent loop noticed the budget was gone. So you may have:

- ✅ 7 code files written and complete
- ❌ No JSON return block (`=== XXX_RESULT ===`) in stdout
- ❌ No state-table append in the TASK document
- ❌ No version bump in the affected specs

**Recovery pattern — "补完 patch"** (a 5-section miniprompt):

```text
# Title
你是 zsspec-<stage> 阶段的补完 agent (n) — 只做 1 件事: <leftover task>.

# Context
- 项目根: <abs path>
- 模块: <name>
- 之前一轮 <stage> 阶段已经完成 <主产物>, 全部 <N> 份文件都已落盘:
  - <file A>: <size>
  - <file B>: <size>
  - ...
- 但前一轮 max-turns 用完, 没 <做 X / 改 Y>

# Required inputs
- Read: <list of files CC must read to understand the leftover>

# Required action (1 thing)
- <Single concrete action — update TASK status table, append to CHK, version-bump, etc.>

# Constraints
- Only modify 1 file: <path>
- Don't re-read or re-do work already done
- Don't run git / pytest
- Don't modify .meta-dev/

# Return block
=== <STAGE>_PATCH_RESULT ===
{ "status": "success" | "failed", "artifact_modified": "<path>", "tool_calls_used": <int>, ... }
=== END_<STAGE>_PATCH_RESULT ===
```

**Why this works**: a "补完 patch" is a tiny, well-scoped 5-15 turn task. It never re-explores the codebase, it only does the 1 status-table append or 1 version bump the main stage was supposed to do. Max-turns 15 is plenty. Total wall time: 1-2 minutes.

**Cost of NOT doing this**: the stage technically "completed" the main artifact, but the state machine and CHK status writes are stale, blocking downstream stages that read those states. A 1-minute补完 prevents a 30-minute recovery.

This extends the "接力 CC" pattern documented in `references/cc-delivery-v2-deltas-zs.md` — that file covers the **generic** "接力 for max-turns" case; this section is the **specific** "补完 the leftover state writes" case.

### 4. zsspec-e2e-gen is Playwright-only by default — document the scope adjustment in `project-profile.yaml` upfront

The `zsspec-e2e-gen` SKILL.md templates are 100% Playwright (browser-driven e2e). For a Python backend project, the natural mapping is **pytest** unit + integration tests, not browser tests. Don't let CC interpret "generate e2e tests" as "write a Playwright config" — that produces zero runnable tests on a backend.

**The fix is in the project-profile.yaml before stage 8**:

```yaml
scope_adjustment:
  e2e_gen_strategy: |
    zsspec-e2e-gen 默认输出 Playwright。本项目是 Python 后端,采用适配变体:
    CHK 中 automation=auto 的检查项,落到 pytest 单元测试 (tests/test_<module>.py + tests/test_<module>_utils.py)。
    CHK 文档本身保持规范格式,只有产物形式做适配。
  e2e_run_strategy: |
    跑 pytest 替代 npx playwright test,统计 pass/fail/skip,回写 CHK 状态。
  reason: 用户硬性要求 18+ pytest 用例,Playwright 与需求不匹配。
```

Then in the stage-8 handoff, repeat the adaptation explicitly so CC doesn't pattern-match against the skill template and generate Playwright code anyway.

### 5. Conftest `sys.modules` mock for transitive import chains in Python packages

When a Python project has `workflow/__init__.py` that does `from .engine import *` and `engine/component_factory.py` imports `agno_agent.components.memory` which transitively imports `mem0ai` (uninstalled or with broken numpy in this env), **any** `import workflow.<anything>` from a test triggers the whole chain. The test sees `ImportError: mem0ai package not found` even though `mem0ai` is irrelevant to what the test is doing.

**Fix at the top of `tests/conftest.py`** (runs before any test collection):

```python
import sys
from unittest.mock import MagicMock
sys.modules["agno_agent.components.memory"] = MagicMock()
sys.modules["agno_agent.components.knowledge"] = MagicMock()
```

The mock lives only in the test process; production imports are unaffected. Tests can now import `workflow.<module>` cleanly.

**Why not a `try/except ImportError` in `workflow/__init__.py`**: that would change production behavior (silently swallow a real `mem0ai` failure). The test-side mock is the right boundary.

### 6. Pydantic `Field(...)` ordering matters for "field order fixed" contracts

`spec` and `CHK` documents that say "response fields are output in fixed order X, Y, Z" are not just documentation — Python's `@dataclass` and Pydantic v2 preserve field declaration order. If a later refactor shuffles the `class Foo(BaseModel)` block, the JSON serialization order changes too, and downstream consumers (and tests asserting key order) break.

**Practice**: in the schema doc, list the field order explicitly ("`name → title → company → phone → email → address → website`"), and in the code comment, repeat the order next to the model:

```python
class BusinessCardResult(BaseModel):
    # Field order is part of the public contract (REQ-012). Do NOT reorder.
    # 姓名 / 职位 / 公司 / 电话 / 邮箱 / 地址 / 网站
    name: str
    title: str
    company: str
    phone: str
    email: str
    address: str
    website: str = ""
```

This survives CC re-reads and refactors.

## Related

- Pitfall 15 in the parent SKILL.md (structural read first)
- Pitfall 16 (Read truncation — this file is the deep-dive)
- Pitfall 17 (auto-improve mode)
- Pitfall 18 (CRLF vs LF)
- Pitfall 19 (byte-diff verification + scripts/verify_byte_exact_blocks.py)
- Pitfall 20 (delegate_task vs terminal+claude -p dispatch)
