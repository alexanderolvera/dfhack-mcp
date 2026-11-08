---
tool: historical_figure
tier: sensor
gated: none
source: src/tools/historicalFigure.ts
lua: src/dfhack-queries/mcp_historicalFigure.lua
tags: [dfhack-mcp/tool]
---

# historical_figure

> ONE historical figure's entry in the world's legends, by hf_id — dead or alive, fort-dweller or not.

## Purpose
`citizen` only reaches living units, so a dwarf drops out of reach the moment they die. This tool reads the figure's record in world history instead: who they were, how and where they died and who killed them, which civilizations and site governments they belonged to and what positions they held, their family and other figure-to-figure links, the deities they worshipped, the sites they were tied to, whom they killed, and which saga events involve them. It works the same for siege generals, visiting bards, megabeasts and deities, the figures `site_history` names but can't drill into. Every related figure carries an `hf_id`, so the caller can walk the graph by calling this tool again.

## Parameters
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| hf_id | integer (coerced, ≥ 0) | Yes | — | A historical figure id, e.g. a relationship's or slayer's hf_id. |

## Returns
- `hf_id` (number), `name` (the figure's name in its own language, e.g. Dwarven for a dwarf), `name_english`. Both are absent for an unnamed figure.
- `race` (creature token, e.g. `"DWARF"`), `caste` (caste token, e.g. `"MALE"`), `sex` (`"male"`/`"female"`, absent when none), `profession` (`df.profession` token).
- `deity?`, `force?`, `ghost?` — `true` only when that flag is set on the figure. `spheres[]` (sorted `df.sphere_type` tokens) appears for figures with a metaphysical profile (deities).
- `alive` (boolean) — `false` exactly when `death` is present. A deity is `alive: true`; DF never records a death for one.
- `birth?` — `{ year }`. Absent for deities and forces, which have no birth.
- `death?` — `{ year, event_id?, cause?, site_id?, site?, slayer? }`. `cause` is a `df.death_type` token (`"BLEED"`, `"STRUCK_DOWN"`, …). `slayer` is `{ hf_id, name?, race? }` for a named killer, or `{ race, caste }` when an unnamed creature did it. The event fields are absent if the death has no `HIST_FIGURE_DIED` event.
- `unit_id?` — the figure's unit id, present only when that unit is loaded on this map AND stands on a discovered tile (see Implementation notes).
- `entities[]` — one row per entity the figure has any link to: `{ entity_id, name?, name_english?, type, links[], positions[] }`. `type` is a `df.historical_entity_type` token (`"Civilization"`, `"SiteGovernment"`, `"Guild"`, …). `links[]` holds the sorted, distinct `df.histfig_entity_link_type` tokens (`MEMBER`, `FORMER_MEMBER`, `POSITION`, `FORMER_POSITION`, `ENEMY`, `SQUAD`, `PRISONER`, …). `positions[]` is `{ position, current, start_year?, end_year? }`, current posts first, then newest first. Sorted by `entity_id`.
- `relationships[]` — `{ type, hf_id, name?, race? }` for every figure-to-figure link except worship. `type` is a `df.histfig_hf_link_type` token (`MOTHER`, `FATHER`, `CHILD`, `SPOUSE`, `DECEASED_SPOUSE`, `LOVER`, `PET_OWNER`, `PRISONER`, `IMPRISONER`, …). Duplicate links are collapsed. Sorted by type, then `hf_id`.
- `worship[]` — `{ hf_id, name?, strength }`, strongest first; `strength` is the link strength (0-100).
- `sites[]` — `{ site_id, name?, name_english?, type, link }`. `link` is a `df.histfig_site_link_type` token (`LAIR`, `SEAT_OF_POWER`, `HOME_SITE_*`, …). Sorted by `site_id`.
- `kills[]` — named figures this one killed: `{ event_id, hf_id, name?, race?, year, cause?, site_id?, site? }`, most recent first.
- `unnamed_kills[]` — `{ race, count }`, kills of creatures that weren't historical figures, summed per race, highest count first.
- `events[]` — `{ event_id, year, type, site_id? }` for every saga event that involves the figure, most recent first. `type` is a `df.history_event_type` token.
- Each list `<key>` also gets `<key>_truncated` (`true`) and `<key>_total` when its cap dropped entries. The same goes for `positions` inside each entity. Neither key is present when nothing was dropped.

```json
{
  "alive": false,
  "birth": { "year": -66 },
  "caste": "MALE",
  "death": {
    "cause": "BLEED",
    "event_id": 618,
    "site": "Fortress of Dreams",
    "site_id": 25,
    "slayer": { "hf_id": 177, "name": "Melbil Drillgorge", "race": "DWARF" },
    "year": 6
  },
  "entities": [
    {
      "entity_id": 23,
      "links": ["FORMER_MEMBER"],
      "name": "Uloliden",
      "name_english": "The Last Paddles",
      "positions": [],
      "type": "SiteGovernment"
    }
  ],
  "events": [
    { "event_id": 618, "site_id": 25, "type": "HIST_FIGURE_DIED", "year": 6 },
    { "event_id": 617, "site_id": 25, "type": "CHANGE_HF_MOOD", "year": 6 }
  ],
  "hf_id": 179,
  "kills": [],
  "name": "Stukos Asmelanam",
  "name_english": "Stukos Merchantage",
  "profession": "METALCRAFTER",
  "race": "DWARF",
  "relationships": [],
  "sex": "male",
  "sites": [],
  "unit_id": 262,
  "unnamed_kills": [],
  "worship": [{ "hf_id": 26, "name": "Thocit", "strength": 35 }]
}
```

## Caveats & limits
- Caps: entities 50, positions 25 per entity, relationships 50, worship 20, sites 25, kills 50, unnamed kills 25, events 50.
- An unknown id returns `{"error":"no historical figure with id N"}`. A non-numeric id returns an `{"error":...}` too, and `{"error":"no fort loaded"}` means no fort is active.
- `events[]` lists ids, types and years only. The tool doesn't expand each event's details beyond what `death` and `kills` already pull out of `HIST_FIGURE_DIED`.
- Every call scans the full saga log (`world.history.events`) once. That's fast on a young world, but on a centuries-old world it costs time in proportion to the number of events.
- `hf_id` is not yet discoverable from `citizen`, `site_history` or `chronicle` (that's #103). Until then, ids come from this tool's own links (relationships, worship, slayer, kills).
- Names pass through CP437-to-UTF-8 conversion (`mcp_jsonOut`), so accented proper nouns are valid JSON.

## Implementation notes
- The figure is `df.historical_figure.find(hf_id)`. Fields confirmed live on DFHack 53.15-r2 (fixture `df-headless:53.15`): `.name` (a `language_name`, rendered with `dfhack.translation.translateName(name, false/true)` and skipped when `.has_name` is false), `.race`/`.caste` (indexes into `world.raws.creatures.all[race].caste[caste].caste_id`), `.sex` (0 female, 1 male, -1 none), `.profession` (`df.profession`), `.born_year`, `.died_year` (-1 while alive), `.unit_id`, `.flags.deity`/`.force`/`.ghost`, and `.info.metaphysical.spheres` (`df.sphere_type`, only on deities).
- A deity has `born_year == -1`, which looks the same as a real year -1 birth. That's why `birth` is skipped by flag (deity/force) rather than by value: world-gen figures legitimately have negative birth years (the fixture's dwarves are born around -60).
- Entity links: `hf.entity_links[]`, typed by `link:getType()` → `df.histfig_entity_link_type`, with `.entity_id` and `.link_strength`. `POSITION` links carry `.assignment_id` and `.start_year`, and `FORMER_POSITION` links add `.end_year`. The position name resolves through `entity.positions.assignments[]` (`.id` → `.position_id`), then `entity.positions.own[]` (`.id`, `.code`, `.name[0]`, `.name_male[0]`, `.name_female[0]`). In 53.15 the gendered names are often empty, so the code falls back to `.name[0]` and then `.code`.
- Figure links: `hf.histfig_links[]`, typed via `df.histfig_hf_link_type`, with `.target_hf` and `.link_strength`. The fixture has the same `LOVER` link recorded twice on one figure, so links are deduplicated on (type, target).
- Site links: `hf.site_links[]`, typed via `df.histfig_site_link_type`, with `.site` (a `df.world_site` id), `.sub_id` and `.entity`. The fixture's night creatures carry `LAIR` links.
- Deaths and kills come from `HIST_FIGURE_DIED` events (`.victim_hf`, `.slayer_hf`, `.slayer_race`, `.slayer_caste`, `.death_cause` → `df.death_type`, `.site`). An unnamed killer has `slayer_hf == -1` but still a race/caste. `hf.info.kills.events` holds the same kill-event ids, but the tool scans the saga instead because it's already walking it for `events[]` and doesn't depend on `info.kills` being present. `unnamed_kills` comes from `hf.info.kills.killed_race[i]` / `killed_count[i]` (parallel vectors, along with `killed_caste`/`killed_site`/`killed_region`/`killed_underground_region`), summed per race.
- `events[]` keeps every entry in `world.history.events` where `event:isRelatedToHistfigID(hf_id)` is true. That's the game's own notion of involvement, so it covers event types the tool never parses itself. `site_id` is read through pcall because only some event types have a `.site`.
- **Fog of war (`mcp_unitVisibility`).** Most of this tool is world history, the legends record DF keeps for the whole world, and none of it is tied to the map. So the legends fields are returned for any figure, the same way `site_history` returns the saga. The one map-bound fact is `unit_id`. Exposing it for a creature in an undiscovered cavern would reveal that it's on the map, the same X-ray leak `mcp_unitVisibility` exists to prevent. So `unit_id` is emitted only when `df.unit.find(hf.unit_id)` returns a loaded unit and `visibility.is_hidden(u)` is false. A figure off the map and a figure on a hidden tile look identical (no `unit_id`), so this fails closed. `hf.unit_id` itself is often set for figures who aren't on this map: in the fixture, the forgotten beasts and fallen world-gen dwarves all have a `unit_id` with no loaded unit behind it. No position or whereabouts is ever emitted.
- T2 goldens: `test/golden/historical_figure.json` is hf 179 (a dead citizen slain by another citizen). `scripts/verify.mjs`'s `HISTORICAL_FIGURE_GOLDEN_IDS` adds `historical_figure.<id>.json` for hf 177 (a living citizen, Stukos's slayer, holding a position), 30 (a dead dwarf with spouse, children, a lover, a former civ position, killed by an unnamed goblin), 4 (a forgotten beast that never came to the fort, with seven named kills and unnamed kills) and 22 (a deity with spheres). The fixture has no figure whose unit stands on a hidden tile, so the `unit_id` gate has no golden that exercises it.

## Related
- [citizen](citizen.md) — the live-unit dossier. Its relations carry `unit_id`s, while this tool carries `hf_id`s.
- [site_history](site_history.md) — this site's saga, which names the generals and notable dead whose ids lead here.
- [chronicle](chronicle.md) — the recent report stream, as opposed to the durable saga read here.
