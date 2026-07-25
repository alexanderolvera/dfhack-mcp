---
tool: blueprint_library
tier: sensor
gated: none
source: src/tools/blueprintLibrary.ts
lua: src/dfhack-queries/mcp_blueprint_library.lua
tags: [dfhack-mcp/tool]
---

# blueprint_library

> Lists quickfort blueprints on disk — DFHack's shipped library (dreamfort et al.) plus the user's own — that blueprint_apply's inline-CSV-only interface otherwise leaves invisible.

## Purpose
`blueprint_apply` only ever designates a CSV the agent drafts itself (`src/tools/blueprint.ts`) — the entire curated library that ships with DFHack (`hack/data/blueprints/`), plus anything the user has dropped in their own `dfhack-config/blueprints/`, was invisible and unusable. This sensor surfaces that library: what's available, under what path, split into which selectable phases (dreamfort.csv alone is dozens of `#dig`/`#build`/`#query`/... phases, each its own list entry), and each phase's own help text. It's browsing/orientation only — see the caveat below.

## Parameters
None.

## Returns
- `entries[]` — one row per selectable modeline (capped at 500 — see `entries_total`/`entries_truncated`): `{ id, path, mode, label?, comment?, cursor_start_hint?, library }`.
  - `id` — this call's list index (quickfort's own numbering; not guaranteed stable across calls if the on-disk blueprint set changes).
  - `path` — file path relative to its root; a library entry is prefixed `library/` (e.g. `library/dreamfort.csv`), a user entry is not (e.g. `my_bedroom.csv`).
  - `mode` — the phase's quickfort mode: `dig`, `build`, `place`, `query`, `zone`, `meta`, `notes`, etc. (today's `blueprint_apply` only accepts `dig`/`zone` — see caveat).
  - `label` — the phase's `label(...)` name from its modeline (e.g. `"surface1"`), absent for a single-phase file with no label. For an `.xlsx` blueprint this is `sheet[/label]`.
  - `comment` — the modeline's own help/description text, when the blueprint author supplied one.
  - `cursor_start_hint` — where quickfort suggests placing the cursor before applying, when the blueprint declares one.
  - `library` — true for a DFHack-shipped entry, false for one of the user's own.
- `entries_total` (number), `entries_truncated` (boolean) — the real entry count and whether the 500-row cap dropped any.
- `library_count` / `user_count` — how many listed entries are library vs. user blueprints (counts the full unfiltered set, not just what fit under the cap).

```json
{
  "entries": [
    { "id": 12, "path": "library/dreamfort.csv", "mode": "notes", "label": "help", "comment": "run me for the dreamfort walkthrough", "library": true },
    { "id": 45, "path": "library/dreamfort.csv", "mode": "dig", "label": "surface1", "cursor_start_hint": "on the surface, away from trees", "library": true },
    { "id": 130, "path": "library/aquifer_tap.csv", "mode": "dig", "library": true }
  ],
  "entries_total": 187,
  "entries_truncated": false,
  "library_count": 179,
  "user_count": 8
}
```

## Caveats & limits
- **Browsing only.** `blueprint_apply` still requires the CSV pasted inline (`csv` parameter); it has no `path`/`label` reference parameter yet, so applying one of these still means sourcing its text yourself. Library-reference support in `blueprint_apply` is a planned follow-up ([#88](https://github.com/alexanderolvera/dfhack-mcp/issues/88)), staged separately because slicing a single phase out of a multi-phase file (and, for `.xlsx`, a single sheet) needs the same care `blueprint_apply` already gives per-cell validation — not something to bolt on without its own verification pass.
- Entries whose modeline is marked `hidden` (internal helper phases not meant for direct selection) are omitted, matching plain `quickfort list`'s default.
- `entries[]` is capped at 500 rows (`entries_total`/`entries_truncated`); `library_count`/`user_count` are unaffected by the cap.
- Returns `{"error":"no fort loaded"}` if no fort is active — the underlying scan doesn't strictly need one, but every tool in this server verifies against a live fort, so the guard matches the rest of the family (`blueprint_apply`/`blueprint_undo`) rather than carving out an exception.

## Implementation notes
Delegates entirely to quickfort's own scan rather than re-parsing blueprint files: `reqscript('internal/quickfort/list')` and its `do_list_internal(show_library=true, show_hidden=false)`, the same function backing the interactive `quickfort list` command. This means CSV modeline parsing, `.xlsx` sheet enumeration, and the user-vs-library/mod directory resolution (`quickfort_set.get_setting('blueprints_user_dir')` / `blueprints_library_dir`) all reuse DFHack's own logic rather than a second, potentially-drifting reimplementation — the same reuse-over-reimplementation posture as `blueprint_apply`/`blueprint_undo`'s dependence on quickfort's real dry-run for validation.

## Related
- [blueprint_apply](blueprint_apply.md) / [blueprint_undo](blueprint_undo.md) — the actuator this sensor's entries still need to be applied through today (inline CSV only).
