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
Reports the fort's named artifacts (paginated) plus an aggregated summary of the map's engravings. Each artifact carries its dwarven/translated name, item type and base material, created value, quality, maker, decorations, and any engraved inscription text (e.g. a slab's secret). Engravings are grouped by the art image they depict, with counts (never itemized per tile). Each group carries the image's title and what it shows (the depicted figures with their histfig ids, items, plants and shapes, the verbs linking them, and the history event it commemorates), alongside a quality histogram and the top engravers. A client calls it to inventory the fort's art, read slab inscriptions, or find which past events and figures the fort's walls depict.

## Parameters
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| limit | integer (coerced, 1-100) | No | 25 | Artifacts per page (max 100). Engravings are always fully aggregated. |
| cursor | string | No | — | Opaque pagination cursor from a previous call's `next_cursor`; omit for the first page. |
| scope | `"site"` \| `"world"` | No | `"site"` | Which artifacts to return. `site` = only the loaded fort's. `world` = every artifact in the world, each row tagged `site_local`. |

## Returns
Top-level fields:
- `scope` — the scope actually applied (`"site"` or `"world"`), echoed so a paged caller can't lose track of it.
- `artifacts` — array of artifact records: `id`, `site_local?` (only in `world` scope), `name {dwarven, english}`, `item_type` (e.g. SLAB), `item_label` (readable, e.g. "microcline slab"), `material {token, name}`, `value`, `quality`, `maker {histfig_id, name, unit_id?}` (`unit_id` present ONLY when the maker is a living current citizen), `decorations[]` (`type`/`material`/`quality`, ART_IMAGE entries carry `image_resolved`), `decorations_truncated?`/`decorations_total?`, `inscription?` (engraved text), `error?` (set only when a single record was unreadable)
- `artifact_count` — total artifacts across all pages **in the applied scope**; `artifact_count_world` — the unfiltered world total, always reported so the fact isn't lost when scoping to the site; `returned`, `cursor`, `next_cursor?` (absent on the last page)
- `engravings` — `total_present`, `scanned`, `scan_truncated`, `distinct_subjects`, `art_images_loaded`, `subjects_resolvable`, `quality` (label → count map), `by_subject[]` (`subject`, `subject_resolved`, `ref`, `count`, `image?`), `by_subject_truncated`, `top_engravers[]` (`name`, `histfig_id`, `unit_id?`, `count`)
- `by_subject[].image` — present exactly when `subject_resolved` is true:
  - `elements[]` — what the image depicts, each with `type` (`CREATURE`/`ITEM`/`PLANT`/`TREE`/`SHAPE`), `name` (DF's own wording, e.g. "Obok Dothalls the dwarf", "a chert door"), `count?`, plus by type: `race` + `histfig_id?` + `unit_id?` (living citizens only) for creatures, `item_type` + `material?` for items, `plant` for plants/trees, `shape` for shapes.
  - `properties[]` — `type` (`transitive_verb`/`intransitive_verb`), `verb` (e.g. `Raising`), `subject` and `object?` as 0-based indices into `elements`, `text` (DF's own sentence, e.g. "Obok Dothalls is raising the chert door.").
  - `event?` — `{id, type, year}` of the history event the image commemorates (e.g. `MASTERPIECE_CREATED_ITEM`).
  - `year` — the year the image was made.
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
  ],
  "engravings": {
    "art_images_loaded": true,
    "subjects_resolvable": true,
    "by_subject": [
      {
        "count": 1,
        "ref": "0:152",
        "subject": "The Tender Morsel",
        "subject_resolved": true,
        "image": {
          "elements": [
            { "type": "CREATURE", "name": "Obok Dothalls the dwarf", "count": 1, "race": "DWARF", "histfig_id": 170, "unit_id": 114 },
            { "type": "ITEM", "name": "a chert door", "count": 1, "item_type": "DOOR", "material": { "name": "chert", "token": "INORGANIC:CHERT" } }
          ],
          "properties": [
            { "type": "transitive_verb", "verb": "Raising", "subject": 0, "object": 1, "text": "Obok Dothalls is raising the chert door." }
          ],
          "event": { "id": 822, "type": "MASTERPIECE_CREATED_ITEM", "year": 6 },
          "year": 7
        }
      }
    ]
  }
}
```

## Caveats & limits
- **Artifacts are site-scoped by default.** `df.global.world.artifacts.all` is a WORLD table, and in a mature world the overwhelming majority of it has nothing to do with your fort. Before 1.4.1 the tool returned all of it with no scope field and no per-row discriminator, so a 2-year-old fort of 57 dwarves reported `artifact_count: 286` — world-gen mythical remnants and other civs' books listed indistinguishably alongside its own five pieces. Scoping keys on the artifact record's own `site` field against `df.global.plotinfo.site_id`.
- Artifact pagination: default 25 per page, hard cap 100; page with `limit` + `next_cursor`. The cursor indexes into the SCOPED list, so a cursor minted under one `scope` is meaningless under the other — keep `scope` fixed while paging.
- Per-artifact decorations are capped at 16 (`decorations_truncated` + `decorations_total` flag the overflow).
- Engraving aggregation scans at most 20,000 engravings (`scan_truncated`); at most 40 subject buckets and 10 top engravers are returned.
- **Engraving subjects resolve by loading DF's art images.** DF keeps them on disk and reads one in only when something views an engraving, so on a freshly loaded fort the table is empty. The tool loads the images its scanned engravings reference the way the engraving view sheet does (see Implementation notes). It does this paused, restores the UI state it touched, and **skips the load while any view sheet is open or a non-fortress screen is on top**, so it never disturbs what the player is looking at. Once loaded, an image stays resident, so later calls resolve without loading again. A subject whose image is not loaded reports `subject_resolved=false` and falls back to its stable reference (`ref` = `<art_id>:<subid>`, rendered `"image #0:70"`). It is never fabricated. `art_images_loaded` reports whether any art image is resident; `subjects_resolvable` reports whether any scanned engraving resolved.
- **Artifact ART_IMAGE decorations stay unresolved** (`image_resolved=false`). On the fixture their `itemimprovement_art_imagest.image` ref carries `id = -1`/`subid = -1` (only `civ_id`/`site_id` are set), so there is no art-image chunk to look up.
- Subject buckets are keyed by image reference, so `distinct_subjects` counts distinct art images. Two different images that happen to share a title stay separate buckets.
- Maker/engraver `unit_id` is present ONLY for living current citizens; historical figures get name only.
- Engravings are never itemized per tile — only aggregated by subject.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Implementation notes
- DFHack's JSON encoder emits ANY empty Lua table as `[]`, never `{}` — so empty-list response fields already arrive as `[]` (the TS wrapper's array guards for them are defensive no-ops); the one coercion that actually fires is `engravings.quality`, a map that arrives as `[]` when empty and gets restored to `{}` to match its declared object shape.

Field paths below were probed live on DFHack 53.15 against "Fortress of Dreams" (78 pop, year 7) and are version-fragile; every risky read in the Lua is pcall-guarded so a missing field yields a labeled fact, not a traceback.

- **Site scoping** uses `artifact_record.site` compared against `df.global.plotinfo.site_id`. Confirmed live on Torchbristled (site 502): 5 of 286 world artifacts carry `site == 502`, and independently exactly 5 artifacts have an item with a real map position — two unrelated derivations agreeing on the same set. `maker.unit_id` was considered as the discriminator and rejected: it is only populated for makers who are *living current citizens*, so it drops a fort's own artifacts made by a dwarf who has since died or by a non-citizen. Torchbristled has a concrete case — artifact 238, "A Course on the Mountainhome", is genuinely held by the fort but its maker resolves to no live unit, so a `unit_id` test would have wrongly excluded it.
- **Artifacts** come from `df.global.world.artifacts.all` (`artifact_record`): `.id`, `.name` (a `language_name`, translated via `dfhack.translation.translateName` — `english=false` gives the dwarven form, `english=true` the readable form), `.item` (the actual item object).
- **The item**: `item:getType()` (`df.item_type`), `dfhack.items.getValue(item)`, `item.quality` (`df.item_quality`; artifacts read "Masterful" = 5), `item.maker` (a HISTFIG id, not a unit id — see cross-reference below), and the polymorphic `item.description` field (present on slabs as the engraved text; absent on e.g. `item_shoesst`, so it's read defensively).
- **Decorations** come from `item.improvements[]` (`itemimprovement_*`): `:getType()` (`df.improvement_type`: BANDS/COVERED/ART_IMAGE/RINGS_HANGING/SPIKES/...), `.mat_type`/`.mat_index` (decoded via `dfhack.matinfo.decode`). ART_IMAGE improvements carry an `.image` ref, which is `-1:-1` on the fixture (see Caveats), so the depicted scene is reported as unresolved rather than fabricated.
- **Engravings** live at `df.global.world.event.engravings`, not `world.engravings`, which does not exist on this build. Each `engraving_data` has `.art_id`/`.art_subid` (the depicted art image: chunk id and slot), `.quality`, `.artist` (a histfig), `.pos`, `.art_civ`/`.art_site`. All 119 fixture engravings use chunk 0, which covers 96 distinct images.
- **Art images** live in `df.global.world.art_image_chunks.all` (`art_image_chunk`: `.id`, `.images`, a fixed 500-slot array of `art_image_chunk_memberst` whose `.art_image` is the `art_image`). DF lazy-loads each chunk from `<save dir>/art_image-<id>.dat` (the fixture's `save/region1/art_image-0.dat`). So the vector is empty after a load (0 chunks on the fixture and on a live 362-engraving fort) until something views an engraving. Earlier versions of this page concluded there was no way to force the load. That was wrong: DF itself loads the chunk when the ENGRAVING view sheet is processed.
- **How the tool loads them (probed live on DFHack 53.15-r2, issue #108).** For each chunk id referenced by a scanned engraving that is not resident, the tool sets `df.global.game.main_interface.view_sheets` to `open = true`, `active_sheet = df.view_sheet_type.ENGRAVING` and `viewing_x/y/z` = that engraving's `pos`, then calls `dfhack.gui.getDFViewscreen(true):logic()` (a `viewscreen_dwarfmodest`). The chunk is in the vector when `logic()` returns, all within the same core-suspended Lua call, so no frame is ever drawn with the sheet open. The tool then restores `open`, `active_sheet`, `active_id`, `viewing_x/y/z`, `engraving_title` and `raw_description`. What was tried and why it is shaped this way:
  - Only `logic()` triggers the load. `render(0)` on the same screen with the same sheet state leaves the vector empty.
  - `logic()` advances the simulation when the game is unpaused: 5 calls moved `cur_year_tick` by 1. While paused it moved 0 ticks. So the tool sets `df.global.pause_state = true` for the load and restores the prior value after.
  - The load is skipped when `view_sheets.open` is already true. The sheet's `description` text box is shared state the tool cannot restore, and clobbering the player's open sheet is not acceptable for a sensor. It is also skipped when the top DF screen is not `viewscreen_dwarfmodest`. Verified: with a unit sheet open, the call leaves the sheet as it was and reports `art_images_loaded=false`.
  - Once loaded, a chunk stays in the vector after the sheet closes (checked across later calls), so the load cost is paid once per chunk per session.
  - The T2 golden is identical whether the chunk was resident before the call or loaded by it (checked on a fresh container).
- **Reading an image**: `art_image` has `.name` (a `language_name`: the title, e.g. "The Boil of Birds"), `.elements[]`, `.properties[]`, `.event` (history event id, -1 when none; 39 of 96 fixture images have one), `.year`, `.artist`, `.site`. Element subclasses are `art_image_element_creaturest` (`race`, `caste`, `histfig`), `_itemst` (`item_type`, `item_subtype`, `mat_type`, `mat_index`, `item_id`), `_plantst`/`_treest` (`plant_id`, indexing `world.raws.plants.all`) and `_shapest` (`shape_id`, indexing `world.raws.descriptors.shapes`, and `shape_adj`). Properties are `art_image_property_transitive_verbst` (`subject`, `object`, `verb`) and `_intransitive_verbst` (`subject`, `verb`); `verb` is `df.art_image_property_verb` (e.g. 11 = Traveling, 12 = Raising), and `subject`/`object` index `elements`.
- **DF's own wording** comes from vmethods that write into a `df.new('string')`. `element:getName(out, definite, use_hf_name, lpage_markup)` gives "a dwarf" / "the dwarf" / "Tun Woodenmines the dwarf" / "Tun Woodenmines" depending on the two flags. The tool passes `(false, true, false)`. `property:getName(out, art_image, use_hf_names, lpage_markup)` gives "Tun Woodenmines is admiring the gauntlets." The tool passes `(img, true, false)`. Setting `lpage_markup` wraps names in `[LPAGE:HF:<id>]...[/LPAGE]`. The tool leaves it off and reports the ids as fields instead.
- **Maker cross-reference**: `item.maker` is a historical figure id. It's mapped to a live `unit_id` only when that histfig is a living current citizen (built from `dfhack.units.getCitizens(true)`, filtered through `dfhack.units.isAlive`); otherwise `unit_id` is omitted.
- **Defensive reads**: DFHack raises when a field is absent from a polymorphic subclass (e.g. `item.description` on a non-slab item), so optional fields are read through a pcall-wrapped getter that treats a miss as nil rather than letting the raise propagate.
- **Name cleanup**: `getDescription`/translated names can carry CP437 control bytes (e.g. the artifact "☼" marker, `0x0F`) wrapped around the text; these are stripped so labels are clean, UTF-safe text.

## Related
- [citizen](citizen.md) — walk a maker's `unit_id` into a full dossier.
- [chronicle](chronicle.md) — artifact-creation events appear in the `artifact` category.
- [rooms_and_zones](rooms_and_zones.md) — where engraved rooms and displayed artifacts live.
