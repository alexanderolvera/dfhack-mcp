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
- **creature** — `token`, `name`, `plural?`, `caste_count`, `size` (body volume cm³), `size_label` (tiny..gigantic), `flags[]` (curated caste flags), `attacks[]` (`{name, verb?}`), `interactions[]` (`{name, material?}` e.g. breath weapons), `description?`, `blurb?`, `unit_id?`/`unit_name?` (when resolved via a live unit_id)
- **material** — `token`, `name`, `state_names {solid, liquid?, gas?}`, `melting_point?`/`boiling_point?`/`ignite_point?` (each `{urist, celsius}`), `flammable`, `density {solid?, liquid?}` (kg/m³), `flags[]`
- **plant** — `token`, `name`, `type` (tree/grass/shrub), `farm_plantable`, `value`, `growth_time` (ticks), `seasons[]`, `surface`/`subterranean`, `depth_min`/`depth_max`, `biomes[]`, `yields[]`, `growths[]`, `materials[]`
- **reaction** — `token`, `name?`, `skill?`, `buildings[]` (`{category, workshop?, custom?}`), `reagents[]` (`{label?, quantity, item?, material?}`), `products[]` (`{item?, improvement?, quantity?, probability?}`)
- **item** — `token`, `name`, `plural?`, `adjective?`, `class` (weapon/armor/tool/ammo/...), `value?`, `stats` (map), `attacks?[]` (`{verb?, contact, penetration, velocity_mult}`)
- **building** — `token`, `name`, `category`, `purpose?`, `dim_x`/`dim_y`, `build_stages`, `reactions[]` (capped at 8, with `reactions_truncated?`/`reactions_total?`)

```json
{
  "attacks": [
    { "name": "BITE", "verb": "bites" },
    { "name": "SCRATCH", "verb": "scratches" }
  ],
  "blurb": "A small mammalian carnivore.",
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
- The source-code comment ("MVP implements the CREATURE kind; other kinds report not yet implemented") is stale — all six kinds are implemented in both the TS types and the Lua dispatch, and the tool description says so.
- Temperature facts carry both raw DF "urist" values and Celsius conversions.
- Empty per-kind lists/maps are normalized ({} vs [] Lua-encoder quirks are coerced in the TS wrapper).

## Related
- [wiki_lookup](wiki_lookup.md) / [wiki_search](wiki_search.md) — general game knowledge; game_data is the ground truth for THIS world, including procedural creatures the wiki can't have.
- [identify](identify.md) — what a live unit IS; game_data is what its species CAN DO.
- [stocks](stocks.md) — items whose materials/reactions this tool explains.
- [threats](threats.md) — pair a threat's creature token with its dossier here.
