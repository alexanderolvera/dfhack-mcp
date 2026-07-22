---
tool: game_data
tier: reference
gated: none
source: src/tools/gameData.ts
lua: src/dfhack-queries/mcp_gameData.lua
tags: [dfhack-mcp/tool]
---

# game_data

> Look up the LOADED WORLD's raws (ground truth for THIS world) and return curated, labeled facts.

## Purpose
The authoritative reference for this world's raws — including procedural creatures (demons, forgotten beasts, titans) that never appear on the wiki. Covers six kinds: creature, material, plant, reaction, item, building. A query resolves by token, case-insensitive name fragment, or (creature kind) a live unit_id. A single strong hit returns a full per-kind dossier; several hits return a disambiguation list; none returns an empty match set.

## Parameters
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| query | string (min 1) | Yes | — | A raws token (e.g. "DEMON_4", "INORGANIC:IRON", "MAKE_SOAP_FROM_TALLOW"), a case-insensitive name fragment (e.g. "flame phantom", "plump helmet"), or — creature kind only — a live unit_id (all digits). |
| kind | enum | No | creature | Which raws table to search: creature, material, plant, reaction, item, building. |

## Returns
Either a **dossier** (single strong hit, shape varies by `kind`) or a **disambiguation list** `{query, match_count, truncated?, matches[]}` where each stub is `{kind, token, name, blurb}`.

Dossier shapes:
- **creature** — `token`, `name`, `plural?`, `caste_count`, `size` (body volume cm³), `size_label` (tiny..gigantic), `flags[]` (curated caste flags), `attacks[]` (`{name, verb?}`), `interactions[]` (`{name, material?}` e.g. breath weapons), `description?`, `unit_id?`/`unit_name?` (when resolved via a live unit_id)
- **material** — `token`, `name`, `state_names {solid, liquid?, gas?}`, `melting_point?`/`boiling_point?`/`ignite_point?` (each `{urist, celsius}`), `flammable`, `density {solid?, liquid?}` (kg/m³), `flags[]`
- **plant** — `token`, `name`, `type` (tree/grass/shrub), `farm_plantable`, `value`, `growth_time` (ticks), `seasons[]`, `surface` (i.e. not subterranean), `depth_min`/`depth_max`, `biomes[]`, `yields[]`, `growths[]`, `materials[]`
- **reaction** — `token`, `name?`, `skill?`, `buildings[]` (`{category, workshop?, custom?}`), `reagents[]` (`{label?, quantity, item?, material?}`), `products[]` (`{item?, improvement?, quantity?, probability?}`)
- **item** — `token`, `name`, `plural?`, `adjective?`, `class` (weapon/armor/tool/ammo/...), `value?`, `stats` (map), `attacks?[]` (`{verb?, contact, penetration, velocity_mult}`)
- **building** — `token`, `name`, `category`, `purpose?`, `dim_x`/`dim_y`, `build_stages`, `reactions[]` (capped at 8, with `reactions_truncated?`/`reactions_total?`)

```json
{
  "attacks": [
    { "name": "BITE", "verb": "bites" },
    { "name": "SCRATCH", "verb": "scratches" }
  ],
  "caste_count": 2,
  "description": "A small mammalian carnivore.  It is usually domestic and hunts vermin.",
  "flags": [
    "COMMON_DOMESTIC",
    "PET"
  ],
  "interactions": [
    { "name": "Clean" },
    { "name": "Head bump" }
  ],
  "kind": "creature",
  "name": "cat",
  "plural": "cats",
  "size": 500,
  "size_label": "tiny",
  "token": "CAT"
}
```

## Caveats & limits
- Disambiguation lists cap at 8 matches; exact matches are listed first so the intended hit survives the cap.
- Building dossiers cap `reactions` at 8 (`reactions_truncated` + `reactions_total` when over).
- `flags` are CURATED advisor-relevant subsets, not the full raw flag dumps.
- No-loaded-game error is `{"error":"no game loaded"}` — note the different wording from the fort sensors' "no fort loaded" (raws only need a world, not a fort).
- Temperature facts carry both raw DF "urist" values and Celsius conversions.
- Empty per-kind lists/maps are normalized ({} vs [] Lua-encoder quirks are coerced in the TS wrapper).

## Implementation notes
- The Lua side is centralized in `src/dfhack-queries/mcp_gameData.lua` with a per-kind dispatch, so adding a new raws kind never requires a new MCP tool. Material dossiers are built via `dfhack.matinfo` rather than a hand-rolled raws walk.
- `plant.farm_plantable` reflects true farm-plot eligibility: the `SEED` flag is set AND the plant is not a tree or grass — not merely "has seeds." Verified live on DFHack 53.15: this rule yields exactly the vanilla 110-crop roster and excludes gather-only wild shrubs with no seed (e.g. kobold bulb, valley herb) and the 47 seeded trees that can't be farmed.
- A `reaction` product without an `item` field is a non-item "improvement" (glaze, encrust, stud, or sew-image); `quantity` is present only on item products, never on improvements.
- `creature.interactions[].material`, when present, is the emitted material token (e.g. `CREATURE_MAT:DEMON_4:POISON`), not a display name.
- The `query`/`kind` parameters arrive as native DFHack argv (`args[1]`/`args[2]`), not through any escaping layer — an apostrophe or backslash in the search term is just data.
- **Creature matching** (verified live on DFHack 53.15-r2 against the "Flame Phantom" demon DEMON_4, unit_id 18393, race 1661): creatures resolve through `df.global.world.raws.creatures.all[race]`. The castes field is `caste` (a vector), not `castes`. `caste.flags` is a bitfield whose TRUE keys are stable token names, iterated with `pairs()` rather than indexed by `df.caste_raw_flags`. Melee attacks (`caste.body_info.attacks[]`) list one entry per left/right body part, so the tool de-duplicates by attack name. Breath-weapon interactions read `interaction.adv_name` for the label — the syndrome vector on the resolved material reads empty on this build, so the emission material token is surfaced directly instead of traversed through syndrome data. `BUILDINGDESTROYER` is not a `caste.flags` bit on this build; it's the numeric field `caste.misc.buildingdestroyer` (confirmed nonzero for DEMON_4 and TROLL), synthesized into the returned flag set so the whitelisted token isn't dead.
- **Polymorphic field reads**: DFHack raises when a field is read on a subclass that doesn't carry it — e.g. `item_type` on a non-item reaction product, or `value`/`name_plural` on an `itemdef_foodst`. Every reagent/product/itemdef field read goes through a pcall-and-treat-miss-as-nil helper rather than assuming the field exists.
- **Material**: resolves via `dfhack.matinfo` — `find(token)` for a fully-qualified token (this also reaches non-inorganic PLANT/CREATURE tissue materials the inorganic index misses) or `decode(0, inorganic_index)` against `df.global.world.raws.inorganics.all`. A query without a `:` searches the inorganic index first, then falls back to a bare-token `matinfo.find` (covers builtins like WATER/COAL) before reporting no matches. Temperature is stored in DF "urists": degF = urist - 9968, and 60001 is the sentinel for "no such point" (a real 60000 is kept as a valid value).
- **Plant**: `material_defs.type[df.plant_material_def]` index 0 is the basic material and index 1 is the tree material — both are excluded from the `yields[]` list, which only reports indices 2-8 (drink/seed/thread/mill/extract_vial/extract_barrel/extract_still_vial).
- **Reaction**: `.building.{type,subtype,custom}` are parallel vectors, not a single building — a reaction can list several (e.g. MAKE_PEARLASH runs at both the Kiln and the Magma Kiln; roughly 35% of raws reactions list more than one), so every aligned index is returned, not just index 0.
- **Item**: not every `itemdef_*st` carries the same fields — `itemdef_foodst` has no `value`/`name_plural`/`adjective`, for example — so optional fields are read defensively rather than assumed present.

## Related
- [wiki_lookup](wiki_lookup.md) / [wiki_search](wiki_search.md) — general game knowledge; game_data is the ground truth for THIS world, including procedural creatures the wiki can't have.
- [identify](identify.md) — what a live unit IS; game_data is what its species CAN DO.
- [stocks](stocks.md) — items whose materials/reactions this tool explains.
- [threats](threats.md) — pair a threat's creature token with its dossier here.
