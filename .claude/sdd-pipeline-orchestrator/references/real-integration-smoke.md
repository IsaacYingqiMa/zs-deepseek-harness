# Real-Integration Smoke Test (stage 10 done 必做)

A 30/30 pytest pass with mocked LLMs and frameworks is **necessary but not sufficient** to declare a module done. The mock absorbs the call before the real framework's validator runs, so integration bugs only surface when the real server actually answers HTTP. This file is the recipe for catching those bugs at stage 10, before the user does.

## When to run

At stage 10 (`zsspec-done` in the zsspec suite, or the final acceptance stage in any SDD suite), **after pytest is green and before declaring the module "ready for user acceptance"**. The whole smoke takes 60-90 seconds and catches an entire class of "mocked-passing, real-failing" bugs.

## The minimum smoke (60s)

```bash
# 1. Start the real server (NOT a test client). Background it.
#    Use the project's actual entry point — server.py / __main__.py / etc.
cd <project_root>
<project_python> server.py &
SERVER_PID=$!
sleep 8  # let uvicorn bind + run discovery

# 2. Confirm the server is up via /api/health
curl -s http://localhost:8080/api/health | jq .

# 3. Send 1 real request to the new endpoint
#    The request MUST exercise the new code path end-to-end, including
#    any LLM / framework integration the mock tests bypassed.
curl -s -X POST http://localhost:8080/api/<module>/<endpoint> \
  -F "file=@<test_fixture>" \
  -H "Accept: application/json" \
  --max-time 60

# 4. Observe the server log
#    Look for: workflow steps firing, LLM calls completing, real timing.
tail -50 server.log

# 5. Kill the server
kill $SERVER_PID
```

If any of the following happens, the module is NOT done — the bug is real, the mock test missed it, and you need to fix + retest:

- HTTP 5xx on a happy-path request
- `AttributeError` / `TypeError` / `ImportError` in the server log
- LLM call never fires (no log line for the vision/text step)
- LLM call returns empty content silently
- Response shape doesn't match the spec's contract (e.g. spec says "bare 7 fields" but response has 8 fields)

If the response is a 4xx with a meaningful error message (e.g. 422 "field missing" because the test image doesn't actually contain phone), that's **a successful smoke** — the framework worked, the test fixture just isn't rich enough. Don't keep iterating.

## Real example from 2026-07-30 business_card_scanner v2

What the supervisor (me) did:

```bash
# Kill any leftover server processes first (common in long sessions)
cmd //c "taskkill /F /PID 41128"
cmd //c "taskkill /F /PID 47444"

# Start fresh
cd D:\浪潮文件\AI大赛\demo_agent
/d/Users/isaac/miniconda3/envs/Agent-frame/python.exe server.py &
SERVER_PID=$!
sleep 10

# Health check — should show 24 agents including v2 vision agents
curl -s http://localhost:8080/api/health | python -c "
import json, sys
d = json.load(sys.stdin)
print('agents with vision/formatter:',
    [a for a in d.get('agents', []) if 'vision' in a or 'formatter' in a])
"

# Real upload — exercises 7-step workflow + 3 LLM calls
curl -s -X POST http://localhost:8080/api/business_card_scanner/scan \
  -F "file=@tests/test_data/business_card.jpg" \
  --max-time 60
```

What the smoke caught that the 37/37 pytest didn't:

```
AttributeError: 'str' object has no attribute 'id'
File ".../agno/utils/agent.py", line 430, in validate_media_object_id
    if not img.id:
```

This was the Agno vision integration bug — pytest mocks absorbed `agent.run` at the object boundary and never hit Agno's internal validator. The fix was a `_to_agno_image()` wrapper (see `references/agno-2.6-vision-integration.md`).

After the fix, the smoke passed: 7 workflow steps fired, 3 LLM calls completed in ~11s total, the test image was processed, the response was 422 "字段缺失:phone" — meaning the framework worked end-to-end and the test fixture just didn't have a phone field in it.

## What "good enough" looks like for a 4xx response

A 4xx is fine if it's the **expected** error for that request. Examples:

- 404 "image not found" when the smoke uploaded a non-existent path (route validation works)
- 415 "unsupported format" when the smoke uploaded a .gif (extension check works)
- 422 "field missing" when the LLM didn't extract enough from a real image (LLM call worked, just no phone in the image)
- 502 "LLM failure" when the API key is wrong (request was routed, LLM attempted, framework caught the failure)

A 4xx is **NOT** fine if it indicates the request never reached the new code:

- 404 on a route that DOES exist (server didn't load the router)
- 405 on POST (router loaded but method missing)
- 500 with no log entry (server crashed before logging)

## Failure modes the smoke catches

| Failure mode | What pytest missed | What smoke catches |
|---|---|---|
| Agno framework kwarg mismatch | Mock absorbs at object boundary | Real `agent.run` call hits Agno's validator |
| LLM API key invalid | Mock returns hardcoded content | Real HTTP 401/403 from upstream LLM |
| Field-order bug in response | Mock doesn't care about key order | Real API consumer (e.g. Apifox) sees wrong order |
| HTTP header missing | Mock response doesn't go through FastAPI | Real curl shows missing/wrong Content-Type |
| Async/sync mismatch in FastAPI | Mock doesn't exercise the router | Real server returns 500 or hangs |
| Multipart form-data parsing | Mock tests use dicts | Real `curl -F` exercises the parser |
| Timezone/date handling in real headers | Mock doesn't add Date header | Real `Server: uvicorn` log shows actual request flow |
| File size / mime validation | Mock tests pass any file | Real `curl -F` of wrong type hits the route's check |
| Pydantic alias serialization | Mock bypasses FastAPI's response_model | Real curl sees unaliased field names |

## What the smoke does NOT catch

- LLM output quality (you'd need a labeled test set to assert extraction accuracy)
- Load / concurrency issues (need a load test, e.g. `locust` or `wrk`)
- Long-running memory leaks (need a soak test)
- CORS / auth / rate-limiting (need a more elaborate smoke with those layers)

These are post-MVP concerns; the smoke is the **minimum bar** for stage 10 done, not the maximum.

## Integration into the done-stage handoff

Add this to the stage-10 handoff (or to the `zsspec-done` skill if you maintain it):

```text
DONE stage exit criteria — ADDITION (2026-07-30):
- [ ] pytest all green
- [ ] Real-integration smoke passes: start real server, curl the new
      endpoint, observe LLM calls firing in the log, verify HTTP 2xx
      or expected 4xx (e.g. 422 field missing on a thin test image)
- [ ] Server log shows the workflow steps executing in order
- [ ] No AttributeError / TypeError / ImportError in the log
```

## Related

- Parent SKILL.md pitfall 26 (mock passing ≠ integration passing) — this file is the deep-dive
- `references/agno-2.6-vision-integration.md` — concrete example of what the smoke caught
- `references/cc-dispatch-quirks.md` — the dispatch layer; smoke is the integration layer
