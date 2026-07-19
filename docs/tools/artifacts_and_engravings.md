---
tool: artifacts_and_engravings
tier: sensor
gated: none
source: src/tools/artifacts.ts
lua: src/dfhack-queries/mcp_artifacts.lua
tags: [dfhack-mcp/tool]
---

# artifacts_and_engravings

> The fort's art, as labeled facts.

## Purpose
Reports the fort's named artifacts (paginated) plus an aggregated summary of the map's engravings. Each artifact carries its dwarven/translated name, item type and base material, created value, quality, maker, decorations, and any engraved inscription text (e.g. a slab's secret). Engravings are grouped by subject with counts (never itemized per tile), alongside a quality histogram and the top engravers. An AI co-pilot calls it to inventory the fort's art or read slab inscriptions.

## Parameters
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| limit | number (int, 1-100) | No | 25 | Artifacts per page (max 100). Engravings are always fully aggregated. |
| cursor | string | No | — | Opaque pagination cursor from a previous call's `next_cursor`; omit for the first page. |

## Returns
Top-level fields:
- `artifacts` — array of artifact records: `id`, `name {dwarven, english}`, `item_type` (e.g. SLAB), `item_label` (readable, e.g. "microcline slab"), `material {token, name}`, `value`, `quality`, `maker {histfig_id, name, is_current_citizen, unit_id?}` (`unit_id` present ONLY when the maker is a living current citizen), `decorations[]` (`type`/`material`/`quality`, ART_IMAGE entries carry `image_resolved`), `decorations_truncated?`/`decorations_total?`, `inscription?` (engraved text), `error?` (set only when a single record was unreadable)
- `artifact_count` — total artifacts across all pages; `returned`, `cursor`, `next_cursor?` (absent on the last page)
- `engravings` — `total_present`, `scanned`, `scan_truncated`, `distinct_subjects`, `subjects_resolvable`, `quality` (label → count map), `by_subject[]` (`subject`, `subject_resolved`, `ref`, `count`), `by_subject_truncated`, `top_engravers[]` (`name`, `histfig_id`, `unit_id?`, `count`)
- `caps` — all documented limits: `default_limit`, `max_limit`, `decorations_per_artifact`, `engravings_scanned_max`, `subject_buckets_max`, `top_engravers_max`

```json
{
  "artifact_count": 6,
  "artifacts": [
    {
      "decorations": [],
      "id": 0,
      "inscription": "I am Pamnot Kamcabekor, Pamnot Dreamedtwilight, once of the Underworld.  By Thocit, I bind myself to this place.",
      "item_label": "microcline slab",
      "item_type": "SLAB",
      "maker": {
        "histfig_id": 53,
        "is_current_citizen": false,
        "name": "Kun the Hood of Spiders"
      },
      "material": {
        "name": "microcline",
        "token": "INORGANIC:MICROCLINE"
      },
      "name": {
        "dwarven": "Uxendof",
        "english": "Searchdents"
      },
      "quality": "Masterful",
      "value": 500
    }
  ]
}
```

## Caveats & limits
- Artifact pagination: default 25 per page, hard cap 100; page with `limit` + `next_cursor`.
- Per-artifact decorations are capped at 16 (`decorations_truncated` + `decorations_total` flag the overflow).
- Engraving aggregation scans at most 20,000 engravings (`scan_truncated`); at most 40 subject buckets and 10 top engravers are returned.
- When the world's art images are not loaded, human scene text is unavailable: `subjects_resolvable` is false and subjects are keyed by their stable image reference (`ref` = `<art_id>:<subid>`) — reported, never fabricated.
- Maker/engraver `unit_id` is present ONLY for living current citizens; historical figures get name only.
- Engravings are never itemized per tile — only aggregated by subject.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Related
- [citizen](citizen.md) — walk a maker's `unit_id` into a full dossier.
- [chronicle](chronicle.md) — artifact-creation events appear in the `artifact` category.
- [rooms_and_zones](rooms_and_zones.md) — where engraved rooms and displayed artifacts live.
