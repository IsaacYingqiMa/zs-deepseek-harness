#!/usr/bin/env python3
"""
verify_byte_exact_blocks.py - Byte-exact verification of CC output against source-of-truth.

Use after any CC dispatch that was supposed to reproduce DSL-embedded code blocks verbatim.
Catches the three silent failure modes observed in the 2026-06-18 migrate_agent session:
  1. CC's Read tool truncates large files (drops tail of long code bodies)
  2. CC "auto-improves" code (rewrites the function with its own logic)
  3. CRLF vs LF line-ending collapse when embedding source from a JSON DSL

Usage:
  python verify_byte_exact_blocks.py \\
      --doc specs/requirement/policy_decomposition/REQ-PD-004*.md \\
      --source 政策事项拆解.json \\
      --node-key code \\
      --code-field code

Exit codes:
  0 = all blocks byte-exact
  1 = at least one block deviates (printed to stderr)
  2 = missing files / parse error

The script is intentionally framework-agnostic: it scans the markdown doc for all
triple-backtick code blocks, then for each one it looks up the source-of-truth
node by id and compares block-for-block.
"""

import argparse
import json
import re
import sys
from pathlib import Path


def extract_python_blocks(doc_text: str) -> list[str]:
    """Return the body of every ```python ... ``` block, in order."""
    return re.findall(r"```python\n(.*?)\n```", doc_text, re.DOTALL)


def extract_node_ids_from_blocks(blocks: list[str]) -> list[str | None]:
    """
    Try to associate each block with a node id by looking for a `### N.M <id>`
    header immediately before the block. Returns None where no match.
    For the common pattern where the block is preceded by a subheading that
    contains the node id, this gives one id per block.
    """
    # This helper is intentionally simple: the caller may also want to pass
    # a richer id-extraction function. Default: scan backward from the
    # block start for the most recent "### ... <id>" pattern in the doc.
    return [None] * len(blocks)  # caller will resolve id by block order


def load_code_bodies(json_path: Path, node_key: str, code_field: str) -> dict[str, str]:
    """
    Walk the JSON DSL and return {node_id: code_body} for every node of
    type matching `node_key` (e.g. "code") whose `code_field` (e.g. "code")
    is a non-empty string. Preserves raw byte content (CRLF included).
    """
    data = json.loads(json_path.read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for node in data.get("nodes", []):
        # Bisheng-style: type is nested under data; tolerate both shapes.
        ntype = node.get("data", {}).get("type") or node.get("type")
        if ntype != node_key:
            continue
        nid = node.get("id", "")
        for gp in node.get("data", {}).get("group_params", []):
            for pi in gp.get("params", []):
                if pi.get("key") == code_field and pi.get("value"):
                    out[nid] = pi["value"]
                    break
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--doc", required=True, help="path to the .md doc CC wrote")
    ap.add_argument("--source", required=True, help="path to the JSON DSL source-of-truth")
    ap.add_argument("--node-key", required=True, help='DSL node type to compare (e.g. "code")')
    ap.add_argument("--code-field", required=True, help='DSL param key holding the code body (e.g. "code")')
    args = ap.parse_args()

    doc_path = Path(args.doc)
    src_path = Path(args.source)

    if not doc_path.exists():
        print(f"[ERR] doc not found: {doc_path}", file=sys.stderr)
        return 2
    if not src_path.exists():
        print(f"[ERR] source not found: {src_path}", file=sys.stderr)
        return 2

    # Read doc as bytes first to preserve CRLF, then decode.
    doc_bytes = doc_path.read_bytes()
    doc_text = doc_bytes.decode("utf-8")
    blocks = extract_python_blocks(doc_text)

    code_bodies = load_code_bodies(src_path, args.node_key, args.code_field)
    if not code_bodies:
        print(f"[ERR] no nodes of type={args.node_key!r} with {args.code_field!r} in {src_path}", file=sys.stderr)
        return 2

    # Pair each code body with a doc block by source order. This assumes
    # the doc enumerates nodes in the same order they appear in the JSON.
    # For richer matching, pass --id-map (TODO).
    ordered_ids = list(code_bodies.keys())
    if len(blocks) != len(ordered_ids):
        print(
            f"[WARN] block count {len(blocks)} != node count {len(ordered_ids)}; "
            f"comparing by order anyway, will report mismatches",
            file=sys.stderr,
        )

    all_ok = True
    for i, nid in enumerate(ordered_ids):
        if i >= len(blocks):
            print(f"❌ {nid}: no corresponding doc block (index {i})")
            all_ok = False
            continue
        expected = code_bodies[nid]
        actual = blocks[i]
        if expected == actual:
            print(f"✅ {nid}: byte-exact ({len(expected)} chars)")
        else:
            all_ok = False
            # Find first divergence
            for k in range(min(len(expected), len(actual))):
                if expected[k] != actual[k]:
                    ctx_e = repr(expected[max(0, k - 20) : k + 30])
                    ctx_a = repr(actual[max(0, k - 20) : k + 30])
                    print(f"❌ {nid}: deviation @ char {k}")
                    print(f"   expected: ...{ctx_e}")
                    print(f"   actual:   ...{ctx_a}")
                    break
            else:
                print(f"❌ {nid}: length mismatch expected={len(expected)} actual={len(actual)}")

    if not all_ok:
        print("\n=== FAILED: at least one block deviates from source-of-truth ===", file=sys.stderr)
        return 1
    print("\n=== PASSED: all blocks byte-exact ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
