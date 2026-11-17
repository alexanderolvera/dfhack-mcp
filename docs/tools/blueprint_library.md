---
tool: blueprint_library
tier: sensor
gated: none
source: src/tools/blueprintLibrary.ts
lua: src/dfhack-queries/mcp_blueprint_library.lua
tags: [dfhack-mcp/tool]
---

# blueprint_library

> Lists quickfort blueprints on disk — DFHack's shipped library (dreamfort et al.) plus the user's own — so blueprint_apply can name one by path and label.

## Purpose
Before this sensor, `blueprint_apply` only ever designated a CSV the agent drafts itself — the entire curated library that ships with DFHack (`hack/data/blueprints/`), plus anything the user has dropped in their own `dfhack-config/blueprints/`, was invisible and unusable. This sensor surfaces that library: what's available, under what path, split into which selectable phases (dreamfort.csv alone is dozens of `#dig`/`#build`/`#query`/... phases, each its own list entry), and each phase's own help text. An entry's `path` and `label` are exactly what [blueprint_apply](blueprint_apply.md) takes as `blueprint_path`/`blueprint_label`.

## Parameters
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| include_hidden | boolean | No | `true` | List blueprints their own modeline marks hidden. `false` gives plain `quickfort list`'s view. |

## Returns
- `entries[]` — one row per selectable modeline (capped at 500 — see `entries_total`/`entries_truncated`): `{ id, path, mode, label?, comment?, cursor_start_hint?, library, hidden }`.
  - `hidden` — true when the blueprint's own modeline marks it hidden: an internal helper phase not meant for direct selection. These are listed by default (see Caveats), so this is how a caller tells them apart.
  - `id` — this call's list index (quickfort's own numbering; not guaranteed stable across calls if the on-disk blueprint set changes).
  - `path` — file path relative to its root; a library entry is prefixed `library/` (e.g. `library/dreamfort.csv`), a user entry is not (e.g. `my_bedroom.csv`).
  - `mode` — the phase's quickfort mode: `dig`, `build`, `place`, `query`, `zone`, `meta`, `notes`, etc. (`blueprint_apply` only accepts `dig`/`zone` — see caveat).
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
    { "id": 130, "path": "library/aquifer_tap.csv", "mode": "dig", "library": true, "hidden": false },
    { "id": 5, "path": "library/bedrooms/28-3-Modified_Windmill_Villas.csv", "mode": "zone", "label": "/zone", "library": true, "hidden": true }
  ],
  "entries_total": 187,
  "entries_truncated": false,
  "library_count": 179,
  "user_count": 8
}
```

## Caveats & limits
- **Listing an entry does not mean it can be applied.** `blueprint_apply` is dig+zone only, so entries whose `mode` is `build`, `place`, `query`, `meta` or `notes` are blocked there with no token. For a multi-phase file like dreamfort that means its dig phases apply and the rest do not.
- Entries whose modeline is marked `hidden` **are listed**, flagged `hidden: true`. Plain `quickfort list` omits them, and so did this tool until [#160](https://github.com/alexanderolvera/dfhack-mcp/issues/160): that hid most of the shipped library — 69 of 149 entries were listed on the fixture, with `entries_total` reporting 69 as though that were all of them, so nothing told the caller the other 80 existed. They are applicable blueprints, so v2.0 lists them and lets the caller decide; pass `include_hidden=false` for the `quickfort list` view.
- `entries[]` is capped at 500 rows (`entries_total`/`entries_truncated`); `library_count`/`user_count` are unaffected by the cap.
- Returns `{"error":"no fort loaded"}` if no fort is active — the underlying scan doesn't strictly need one, but every tool in this server verifies against a live fort, so the guard matches the rest of the family (`blueprint_apply`/`blueprint_undo`) rather than carving out an exception.

## Implementation notes
Delegates entirely to quickfort's own scan rather than re-parsing blueprint files: `reqscript('internal/quickfort/list')` and its `do_list_internal(show_library=true, show_hidden=include_hidden)`, the same function backing the interactive `quickfort list` command. DFHack's list *filters* hidden modelines out rather than marking them — confirmed live: a hidden-only entry carries no `hidden` field, just `id`/`library`/`mode`/`path`/`search_key`/`section_name` — so the `hidden` flag is computed as the difference between the two listings, scanning once with hidden shown and once without. That is why a scan failure in either call is reported rather than defaulted: a missing second listing would silently mark every entry `hidden: false`. This means CSV modeline parsing, `.xlsx` sheet enumeration, and the user-vs-library/mod directory resolution (`quickfort_set.get_setting('blueprints_user_dir')` / `blueprints_library_dir`) all reuse DFHack's own logic rather than a second, potentially-drifting reimplementation — the same reuse-over-reimplementation posture as `blueprint_apply`/`blueprint_undo`'s dependence on quickfort's real dry-run for validation.

## Related
- [blueprint_apply](blueprint_apply.md) / [blueprint_undo](blueprint_undo.md) — take an entry's `path`/`label` as `blueprint_path`/`blueprint_label`.
