# Agno 2.6.5 Vision Integration — Real Production Quirks

Observed 2026-07-30 in the business_card_scanner v2 module. This file captures the integration details that pytest mocks cannot catch and that the official Agno docs do not surface.

## TL;DR

When wiring up a vision LLM via Agno 2.6.5's `agent.run(prompt, images=...)` kwarg, you MUST convert the input to `agno.media.Image` objects before passing. Agno's validator (in `agno/utils/agent.py:validate_media_object_id`) inspects every element of the `images=` list for an `.id` attribute — raw strings, data URLs, and PIL.Image objects all fail this check with `AttributeError: 'str' object has no attribute 'id'`.

**The symptom only appears at real runtime**. Mock-based pytest passes (because `mock.patch.object(agent.run, return_value=...)` absorbs the call before Agno's validator runs).

## The exact failure

```
File ".../agno/agent/agent.py", line 1358, in run
    return _run.run_dispatch(...)
File ".../agno/agent/_run.py", line 1285, in run_dispatch
    image_artifacts, video_artifacts, audio_artifacts, file_artifacts = validate_media_object_id(
File ".../agno/utils/agent.py", line 430, in validate_media_object_id
    if not img.id:
           ^^^^^
AttributeError: 'str' object has no attribute 'id'
```

The `images=` kwarg accepts a list. Each element must satisfy `hasattr(elem, 'id')`. The only type that does is `agno.media.Image`, which is a Pydantic model with fields:

```python
class Image(BaseModel):
    url: Optional[str] = None
    filepath: Optional[Union[Path, str]] = None
    content: Optional[bytes] = None
    id: Optional[str] = None
    format: Optional[str] = None
    mime_type: Optional[str] = None
    detail: Optional[str] = None
    # ...
```

So you need at minimum `.id` and either `.content` (bytes) or `.filepath` or `.url`.

## The wrapper that fixes it

This is the working helper. Drop it next to your `agent.py`:

```python
def _to_agno_image(item):
    """Convert any of (PIL.Image, data-URL str, file-path str) to agno.media.Image.

    Used by Agno 2.6.5's agent.run(images=...) — direct strings/data URLs fail
    the framework's internal validator (no .id attribute).
    """
    try:
        from agno.media import Image as AgnoImage
    except ImportError:
        return item  # no agno → leave as-is, hope for the best

    # Already an agno Image
    if hasattr(item, "id") and getattr(item.__class__, "__name__", "") == "Image":
        return item

    # PIL.Image → encode to bytes
    if hasattr(item, "save") and hasattr(item, "size"):
        from io import BytesIO
        buf = BytesIO()
        fmt = (getattr(item, "format", None) or "PNG").upper()
        if fmt == "JPG":
            fmt = "JPEG"
        item.save(buf, format=fmt)
        mime = "image/jpeg" if fmt == "JPEG" else f"image/{fmt.lower()}"
        return AgnoImage(content=buf.getvalue(), mime_type=mime)

    # data URL: "data:image/jpeg;base64,....."
    if isinstance(item, str) and item.startswith("data:") and ";base64," in item:
        import base64
        header, b64 = item.split(",", 1)
        mime = header.split(";")[0].split(":", 1)[1]
        return AgnoImage(content=base64.b64decode(b64), mime_type=mime)

    # file path
    if isinstance(item, str):
        from pathlib import Path
        p = Path(item)
        if p.exists():
            return AgnoImage(filepath=str(p))

    return item  # last-resort pass-through
```

Wrap your `agent.run` call:

```python
def _safe_agent_run_with_image(agent, prompt, *, image=None, images=None):
    payload = None
    if images is not None:
        payload = [_to_agno_image(x) for x in images]
    elif image is not None:
        payload = [_to_agno_image(image)]

    if payload is not None:
        try:
            return agent.run(prompt, images=payload)
        except TypeError:
            pass  # Agno version that doesn't accept images=; fall through
    return agent.run(prompt)
```

## Why mocks don't catch this

A test like:

```python
with mock.patch.object(agent_module.vision_extractor_agent, "run",
                      return_value=MockResponse(content="...")):
    wf.run_scan(file_path="x.jpg")
```

…absorbs the `agent.run` call at the **object boundary**. Agno's `agent.run` method never executes, so `validate_media_object_id` never runs, and the test passes. The test "proves" the workflow logic is correct, but it proves nothing about the actual integration with the Agno framework.

This is the same class of failure described in pitfall 26 of the parent SKILL.md: "Mock-based pytest passing does NOT prove real LLM/framework integration works." For the specific case of `images=`, the bug surfaces as `AttributeError` 100% of the time, not stochastically — once you run the server for real, the failure is deterministic.

## Mitigation strategies

1. **Always run a real-integration smoke** before declaring stage 10 done (see `references/real-integration-smoke.md`). A 30/30 pytest pass with mocked LLM is necessary but not sufficient.
2. **Add an integration test** that exercises the real `agent.run` path, not the mock — even a single happy-path test that calls `agent.run` with a real (small) image and asserts the call returns a non-`None` response. This catches `AttributeError` immediately.
3. **Test the `_to_agno_image` helper** in isolation: pass a data URL, assert the result is an `agno.media.Image` instance with the expected `.content` and `.mime_type`. This is a unit test that doesn't require a live LLM.
4. **Wrap all vision-LLM call sites** in a single helper (`_safe_agent_run_with_image` or similar) so the conversion logic lives in one place. Don't let `agent.run(images=...)` calls leak into the workflow code unconverted.

## Image variants — what Agno accepts

| Input | Convert to | Notes |
|---|---|---|
| `PIL.Image.Image` | `AgnoImage(content=bytes, mime_type="image/jpeg"\|"image/png")` | `BytesIO` + `save()` + `getvalue()` |
| `"data:image/jpeg;base64,..."` | `AgnoImage(content=base64.b64decode(...), mime_type="image/jpeg")` | Split on `","` after `";base64,"` |
| `"/path/to/image.jpg"` (str) | `AgnoImage(filepath="/path/to/image.jpg")` | `Path(path).exists()` first |
| `pathlib.Path(...)` | `AgnoImage(filepath=str(path))` | Auto-coerced |
| `bytes` (raw) | `AgnoImage(content=bytes, mime_type="...")` | Need mime externally |
| `None` (omit) | N/A | Falls through to text-only call |

## Other Agno 2.6.5 quirks worth noting

These didn't bite in the 2026-07-30 session but are worth being aware of for future vision work:

1. **`agent.run()` returns an `RunResponse` with `.content` attribute, not a dict.** Test mocks must return a mock with `.content`, not a plain string. Pattern:

   ```python
   class _Resp:
       def __init__(self, content): self.content = content
   return _Resp('{"name": "..."}')
   ```

2. **`agent.run(stream=True)` returns an iterator**, not a `RunResponse`. The wrapper should detect the streaming case and adjust.

3. **Vision LLM calls take 1-5 seconds per call.** A 3-LLM vision pipeline takes 5-15 seconds end-to-end. Set FastAPI request timeout accordingly (default 60s is fine; < 30s will trip).

4. **`images=[None]` will fail**, but `images=[]` is treated as no images. The wrapper should filter Nones.

5. **If the vision LLM refuses to look at the image** (e.g. "I cannot see images"), the response will have `content` as a refusal string, not JSON. The downstream JSON parser will fail; the wrapper should detect this and raise a clearer exception.

## Related

- Parent SKILL.md pitfall 26 (mock passing ≠ integration passing)
- Parent SKILL.md pitfall 27 (the original observation; this file is the deep-dive)
- `references/real-integration-smoke.md` — the recipe for catching this kind of bug at stage 10
