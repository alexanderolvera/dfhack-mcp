---
tool: run_lua
tier: dev
gated: dev-only
source: src/tools/runLua.ts
tags: [dfhack-mcp/tool]
---

# run_lua

> DEV-ONLY escape hatch: run an arbitrary DFHack Lua snippet and return its printed output verbatim.

## Purpose
Executes an arbitrary DFHack Lua chunk inside the running game and returns whatever it prints, unparsed. It exists for probing new game-data fields while authoring the real, curated tools — not for agents in normal operation. Because arbitrary Lua can READ AND WRITE game state, this tool bypasses the read-only guarantee every other sensor upholds, which is exactly why it is gated off by default.

## Parameters
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| snippet | string (min 1) | Yes | — | DFHack Lua chunk; use `print(...)` to emit output. |

## Returns
- `output` (string) — the snippet's printed output, verbatim (not parsed as JSON).

No golden fixture exists for this tool.

```json
{
  "output": "78\n"
}
```

## Caveats & limits
- Dev-gated: registered ONLY when the `DFHACK_MCP_DEV` environment variable is set (see `isGatedOff` in `src/register.ts`); with neither gate env var set the server surface is exactly the read-only curated tools.
- NOT read-only: the snippet can mutate game state. Treat every call as potentially side-effectful.
- Output is returned raw — no JSON parsing, no normalization, no `{"error":"no fort loaded"}` convention; the snippet itself decides what to print.
- Known operational gotcha: on a fresh DFHack session the first runScript-style call can fail until an addScriptPath round-trip lands (masquerades as "no fort loaded" in verify T2) — warm up before trusting a first failure.
- Errors from the DFHack side are framed by the shared error wrapper as `{"error":"run_lua failed: <message>"}`.

## Related
[game_data](game_data.md) · [fort_status](fort_status.md) (the curated tools this hatch exists to help author)
