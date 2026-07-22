---
tool: game_save
tier: actuator
gated: actuator
source: src/tools/gameSave.ts
lua: src/dfhack-queries/mcp_gameSave.lua
tags: [dfhack-mcp/tool]
---

# game_save

> Checkpoint the fort with a quicksave.

## Purpose
Freezes the CURRENT game state to disk via DFHack's maintained `quicksave` script, so a subsequent large or risky change can be rolled back by loading the save. EXECUTE-NEVER-DECIDE: takes no operation arguments — it saves the state as-is, never deciding whether now is a good time to save. Follows the shared §A0 two-call actuator protocol: a call WITHOUT `confirm_token` is a dry-run returning a preview and a single-use token; a second call WITH the token applies. Unlike the other actuators, the signature is a CONSTANT (`'game_save'`) rather than target-specific — a save always freezes whatever the current state is, so there's no sub-target whose drift should void the token.

## Parameters
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `confirm_token` | string | no | — | omit to DRY-RUN; pass the returned token to APPLY |

## Returns
**Dry-run** (no `confirm_token`): `{mode: "preview", applied: false, preview, confirm_token}` where `preview` carries `{fort_name?, method: "quicksave", game_date, reversible: false, effect}` — the facts about what confirming would freeze and trigger.

**Apply** (valid `confirm_token`): `{mode: "apply", applied: true, changes, undo, readback}`:

```json
{
  "mode": "apply",
  "applied": true,
  "changes": {
    "save_requested": true,
    "method": "quicksave",
    "game_date": { "year": 250, "year_tick": 12000, "month": "Slate", "season": "Spring", "day": 11 }
  },
  "undo": {
    "reversible": false,
    "note": "no undo — once written, the save persists. To roll back, load the appropriate save/autosave from before this call in DF"
  },
  "readback": {
    "dispatched": true,
    "command_result": 0,
    "write": "asynchronous — DF commits the save over the next few frames via its autosave; this call cannot confirm the file has landed",
    "game_date": { "year": 250, "year_tick": 12000, "month": "Slate", "season": "Spring", "day": 11 }
  }
}
```
*(illustrative shape from the code paths; no golden exists for actuators — the write is asynchronous, so it's verified live by hand, not in the harness.)*

## Caveats & limits
- Gated: registered only when the `DFHACK_MCP_ACTUATORS` env var is set; absent from the default read-only surface.
- **Asynchronous**: `apply()`'s `readback.dispatched` confirms the `quicksave` command was accepted (`command_result 0`), NOT that the save file has finished writing — DF commits it over the next few frames.
- **Routes through DF's autosave**: the write lands in a rotating "autosave N" folder per the player's DF autosave settings, not an overwrite of the loaded region save. No destination folder is reported — `cur_savegame.save_dir` lags a save behind and is config-dependent, so naming one would mislead.
- **Irreversible**: there is no undo handle beyond a note — once written, a save can't be un-written from here. Roll back by loading the appropriate save/autosave in DF.
- Delegates to DFHack's maintained `quicksave` script rather than poking `save_progress.*` fields directly, so a future DFHack field rename is DFHack's problem, not this tool's.
- Fortress mode only. Returns `{"error":"no fort loaded"}` if no fort is active.

## Implementation notes
`apply()` delegates to DFHack's stock `quicksave` script via `dfhack.run_command_silent('quicksave')` rather than `run_command`, so the script's own console print ("The game should autosave now.") doesn't leak into this tool's JSON stdout. A `command_result` of 0 is `CR_OK`; any other value is treated as a dispatch failure and surfaced as an error.

## Related
[fort_status](fort_status.md) (the game date this checkpoints), [blueprint_apply](blueprint_apply.md) / [work_order_create](work_order_create.md) (other actuators a save typically precedes).
