# Handoff Pack — Per-Stage Claude Code Dispatch

Copy this template, fill in `<...>` fields, and pass it as the prompt to `claude -p`.

---

```
PROJECT: <absolute path to project root — becomes workdir>
MODULE: <module name, e.g. "知识管理-RAG对话">
CURRENT_STAGE: <stage name from the SDD skill suite>
STAGE_SKILL:
<inline the full body of the current stage's SKILL.md here>

PRIOR_ARTIFACTS:
- <relative path under project>: <one-line summary of what it contains>
- <relative path>: <one-line summary>
- ...

HARD_CONSTRAINTS (from project CLAUDE.md, inline relevant bullets):
- <bullet from CLAUDE.md>
- <bullet from CLAUDE.md>

KNOWN_FAILURE_MODES (from supervisor memory for THIS module):
- <bullet — e.g. "previous run of e2e-run timed out on Playwright browser launch; use chromium headless and pre-warm">
- <bullet>

WHAT TO PRODUCE (artifacts you must create or update):
- <file path>: <what should be in it>
- <file path>: <what should be in it>

STATUS_WRITES_REQUIRED (you must update these fields in-place):
- <file> field "<field path>" → <expected value>
  e.g. specs/task/.../TASK-...md task.status → "已完成"

HARD_GATES TO RESPECT (do NOT cross these — stop and report verbatim):
- <copy the <HARD-GATE> block from the stage's SKILL.md, verbatim>
- If you reach a HARD-GATE, write a one-line report to:
  HERMES_HOME/state/sdd/<module>.yaml field "stage_blocked_reason"
  and EXIT without writing status to the next stage.

EXIT_CRITERIA: <one-line definition of "done" for this stage>

CONSTRAINTS:
- --max-turns <n>            (suggest: 5 for spec/doc stages, 15 for apply, 3 for verify/review)
- --max-budget-usd <m>       (suggest: 0.50 for doc stages, 2.00 for apply)
- --allowedTools "Read,Edit,Write,Bash"
- workdir: <project root>

REPORT_BACK_FORMAT (print this to stdout at the end):
{
  "stage": "<name>",
  "status": "completed | failed | blocked",
  "artifacts_produced": ["<path>", ...],
  "status_writes_done": [{"file": "<path>", "field": "<field>", "value": "<v>"}],
  "hard_gate_hit": null | "<the gate's text, verbatim>",
  "exit_criteria_met": true | false,
  "notes": "<free-form>"
}
```

---

## Why each section is there

- **STAGE_SKILL inlined** — Claude Code is a fresh process; it has no memory of the SDD suite. Inlining the SKILL.md body is the only reliable way to convey "what this stage means."
- **PRIOR_ARTIFACTS as paths, not contents** — point Claude Code to read them itself. Saves prompt tokens and lets the model decide how much of each artifact to actually load.
- **HARD_GATES copied verbatim** — Claude Code cannot interpret a paraphrase of a HARD-GATE. The verbatim text is what triggers the right behavior in the model.
- **EXIT_CRITERIA as a single line** — disambiguates "done" from "I think I might be done." If the criterion is multi-sentence, the model will find a way to claim completion prematurely.
- **REPORT_BACK_FORMAT as JSON** — makes the supervisor's validation step a deterministic parse, not a free-text interpretation.

## Anti-patterns to avoid

- **Don't summarize the SKILL.md.** Inline the full body. Summaries lose HARD-GATEs.
- **Don't include the prior stage's full output in the prompt.** Reference by path.
- **Don't combine multiple stages into one dispatch.** One stage per pack. Always.
- **Don't set --max-turns to 1.** Claude Code needs room to read files, think, write, re-verify. 1 turn = no actual work.
- **Don't set --max-budget-usd below 0.10.** Anthropic's minimum is ~$0.05 for prompt-cache creation. Below that the dispatch errors before starting.
