# JSON DSL → Code Workflow Reproduction Pattern

This reference captures the pattern of "the user hands you a flow-style JSON DSL (Bisheng flow, n8n, Zapier-like, Airflow DAG JSON, etc.) and asks you to reproduce it as code in a target framework." Use it when the supervisor's handoff to Claude Code must include a concrete mapping from DSL nodes to framework constructs.

## When to load this reference

Load when the user's request matches:

- "复现 / reproduce / 实现 / implement this JSON workflow as code"
- "把这个 flow 翻译成 [framework] 的代码"
- "Build a [framework] workflow that does what this DSL describes"
- "I have this n8n/Bisheng/Airflow JSON; implement it in [framework]"

The pattern is framework-agnostic in its first three steps (read structurally, classify nodes, map to framework). The framework-specific piece (e.g. "zdata-agent-starter Agno Workflow") is a parameter the supervisor fills in.

## The reproduction pipeline (always 4 phases)

### Phase 1 — Structural read (mandatory before any response)

Before answering the user, do a structural read of the DSL. For JSON: write a small Python script that walks the file and produces:

```
- Total nodes: N
- Total edges: M
- Node types and counts (e.g. {start: 1, input: 1, llm: 5, code: 8, condition: 2, end: 3, output: 3})
- Per node: {id, type, name, key params}
- Edges: list of (source, target, handle) — handles matter for branching
- Entry node(s) and exit node(s) by reachability
```

**Do not** try to summarize a 25-node flow by reading the first 80 lines. The first node is just `start`. The topology, conditions, and LLM prompts live later in the file. Use `execute_code` to parse, not `read_file` to scroll.

### Phase 2 — Classify nodes into framework primitives

Most flow DSLs have a small node-type vocabulary. Map each DSL node type to one of these framework primitives:

| DSL primitive | Framework primitive | Notes |
|---------------|---------------------|-------|
| `start` / `trigger` | Route entry point / Workflow constructor | Usually no code; just marks the entry |
| `input` / `form_input` | Request schema / Pydantic model | Extract the field list → write a model |
| `output` / `output_form` | Response model / Pydantic model | Same as input, for the return type |
| `end` | Implicit (last step) | No code; just the workflow's terminal state |
| `llm` / `chat` / `agent` | One `Agent` per LLM node (or shared if same model+system_prompt) | Inline the model + system_prompt + user_prompt template |
| `code` / `function` / `script` | A pure function in `utils/<module>.py` | DSL often includes the code body verbatim — preserve it |
| `condition` / `if` | A branch step in the workflow | Read the condition from the DSL; usually a Python expression |
| `loop` / `foreach` | A loop step wrapping a sub-workflow | Edge with a back-edge |
| `parallel` | A `ParallelStepGroup` (or framework equivalent) | Group of nodes that share an edge source |
| `merge` / `join` | A barrier / collect step | All incoming edges must complete before proceeding |
| `http` / `api` / `tool` | A tool definition wired into the relevant agent | DSL usually carries the URL/body template |
| `knowledge` / `rag` | A `KnowledgeBase` / vector store reference | Wire into the LLM agent's `tools=[]` |

**Decision rule for merging**: two LLM DSL nodes with the same `system_prompt` body and same `model_id` may map to one framework Agent if they also have the same input/output contract. Otherwise they stay as two separate Agents. The supervisor must check both the prompt text and the data flow before merging.

**Decision rule for branching**: a `condition` node with two outgoing edges on different `sourceHandle` values maps to a 2-way branch. If the same node has 3+ outgoing edges on different handles, map to an n-way switch (Python: `match` / `if/elif/else`).

### Phase 3 — Decide the file layout

For most framework targets, the supervisor should land code in three zones:

```
<framework>/                    # (e.g. Agno, LangGraph, custom)
├── agents/<domain>/            # One .py per Agent (or one .py for a small team)
├── workflows/<name>.py         # One .py per Workflow
├── utils/<domain>.py           # Pure functions for DSL `code` nodes
└── routes/<name>.py            # FastAPI / API entry that invokes the workflow
```

The supervisor must tell CC explicitly which zone each generated file goes into. This prevents the "everything in one file" failure mode.

### Phase 4 — Handle prompt template variables

DSL user_prompts often contain template variables like `{{#input_56425.policy_body#}}` or `{{#code_d29c4.paragraphs#}}`. These are references to upstream node outputs.

Pattern for the supervisor's handoff:

1. List every variable reference in every prompt
2. Build a `var_map`: `{variable_name: upstream_node_id + output_field}`
3. Tell CC: in the framework's prompt-builder, replace each variable with the framework's equivalent of "the output of upstream node X, field Y"
4. The framework usually has a context object that flows between steps; CC must use it, not re-read files

Concrete example (from a Bisheng flow migration):
- DSL: `{{#code_d29c4.paragraphs#}}` inside the user_prompt of `llm_30cd7`
- Framework (Agno Workflow): CC must read `ctx.state.get_path('paragraphs')` (set by the previous `code_d29c4` step) and inject it into the prompt at runtime, not hardcode the DSL's variable name

## Concrete worked example: Bisheng flow → zdata-agent-starter Agno workflow

This is the example from the session that produced this reference. Captured because the pattern will repeat.

**Input DSL**: `政策事项拆解.json` (55KB, 25 nodes, 24 edges, 5 LLM, 8 code, 2 condition, 3 end + start)

**Structural read output (abbreviated)**:
```
Nodes by type:
  start (1): start_7f8d8
  input (1): input_56425  → fields: file_id, policy_title, policy_body, department
  condition (2): condition_8a92c (post-input), condition_5388b (mid-flow)
  llm (5): llm_f478c (判断文章类型), llm_30cd7 (政策奖补提取), llm_37955 (单一事项提取),
           llm_d0b12 (事项描述), llm_a2d35 (单一事项描述)
  code (8): code_d309a (html输入转化), code_d29c4 (段落拆分), code_be503 (政策查重),
            code_179f1 (添加原文), code_3c9d4 (段落打标), code_946ff (添加原文2),
            code_85181 (政策提取结果), code_a7ab6 (单一政策提取结果),
            code_9568d (事项描述处理输出), code_370d7 (单一事项描述处理输出)
  output (3): output_35ce0, output_32a4d, output_891aa
  end (3): end_fa50c, end_703fd, end_4a4e1

Edges by source:
  start_7f8d8 → input_56425
  input_56425 → condition_8a92c
  condition_8a92c → llm_f478c  (handle: right)
  condition_8a92c → output_35ce0 (handle: ff5949eb)  ← early-exit branch
  llm_f478c → code_d309a → code_d29c4 → code_3c9d4 → condition_5388b
  condition_5388b → llm_30cd7  (handle: right) ← multi-policy branch
  condition_5388b → llm_37955 (handle: a43616ee) ← single-policy branch
  ... (etc.)
```

**Mapping to zdata-agent-starter**:
```
agents/policy_decomposition/
├── article_type_classifier.py    ← llm_f478c (判断文章类型)
├── multi_policy_extractor.py     ← llm_30cd7 (政策奖补提取)
├── single_policy_extractor.py    ← llm_37955 (单一事项提取)
├── multi_policy_describer.py     ← llm_d0b12 (事项描述)
└── single_policy_describer.py    ← llm_a2d35 (单一事项描述)

utils/policy_decomposition.py     ← 8 code nodes as pure functions
workflow/policy_decomposition.py  ← Agno Workflow with conditions
routes/policy_decomposition.py    ← FastAPI router, ROUTE_PREFIX = "/api/workflows/policy_decomposition"
```

**Concrete failure modes observed in this pattern**:

- CC merges two LLM nodes into one because they have similar names. Reject unless prompts AND data contracts match exactly.
- CC re-implements the `code` nodes as inline agent instructions. Reject — code nodes are deterministic transforms; LLM nodes are probabilistic. Keep them separate.
- CC drops the `condition_8a92c → output_35ce0` early-exit edge. This collapses the flow into a single always-execute path. Reject — the early exit is the "non-policy input" guard.
- CC doesn't honor `sourceHandle` for branching. The default edge handle (`right_handle`) and the alternate handle (`a43616ee`, `ff5949eb`) mean different things. The supervisor must extract these explicitly in the handoff.
- CC writes `ctx.state.set_path('policy_body', ...)` for an input that arrives in `payload['policy_body']` and is *also* on the `input` node. CC must pick ONE source of truth; usually `payload` is cleaner because the workflow receives it once.

## Handoff template additions for this pattern

When dispatching CC for a JSON-DSL reproduction, the handoff pack (see `templates/handoff-pack.md`) should add these sections:

```text
DSL_SOURCE: <path to the .json / .yaml DSL>
DSL_STRUCTURAL_MAP: <output of Phase 1>
DSL_TO_FRAMEWORK_MAP: <output of Phase 2>
TARGET_FILE_LAYOUT: <output of Phase 3>
DSL_VARIABLE_MAP: <output of Phase 4 — every {{#...#}} reference mapped>
EARLY_EXIT_BRANCHES: <list of edges with non-default sourceHandle that are NOT the main flow>
```

The `EARLY_EXIT_BRANCHES` section is the most-skipped. It's the source of subtle bugs because it's a structural feature, not a content feature.

## When this pattern does NOT apply

- The "JSON" is really a config file (single object, no graph topology) → handle as config, not workflow
- The DSL is a single linear pipeline with no conditions/branches → use the simpler `references/zsspec-stage-map.md` style, no topology mapping needed
- The user wants the *opposite* direction (run an existing workflow, capture its execution as JSON) → that's "code → DSL" not "DSL → code"; different problem
- The DSL is so large (>100 nodes) that it likely needs sub-workflow decomposition → break into modules using the SDD pipeline first, then map each module

## Related references

- `references/zsspec-stage-map.md` — the SDD stage flow the supervisor uses for any module-level reproduction
- `references/migrate-agent-first-principles.md` — the framework-specific constraints (auto-discovery, agno_agent.* namespace, file layout conventions)
- `templates/handoff-pack.md` — the base handoff template this pattern extends
