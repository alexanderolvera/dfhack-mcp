---
tool: site_history
tier: sensor
gated: none
source: src/tools/siteHistory.ts
lua: src/dfhack-queries/mcp_siteHistory.lua
tags: [dfhack-mcp/tool]
---

# site_history

> This fort's entry in the PERMANENT world saga (the durable history event log, not the pruned live report stream).

## Purpose
Reads the durable world-history event log for the loaded site only: the founding (year, in-game date, owning civilization in Dwarven and English), the fort name in both languages with a word-by-word etymology, prior sieges/battles fought AT this site, and the notable historical figures who died here. An AI co-pilot calls it for storytelling and chronicle context that survives across seasons — unlike the live report stream, this data is never pruned. Scoped strictly to the loaded site_id; never a world-gen data dump.

## Parameters
None.

## Returns
- `site_id` (number), `site_name` (Dwarven, e.g. "Geshud Nåzom"), `site_name_english`, `site_type` (df.world_site_type token, e.g. "PlayerFortress").
- `pos` — `{ x, y }` world coordinates.
- `current_year` (number), `age_years` (number, absent if founding year unknown).
- `founding` — `{ year?, date?, civ_id, civ?, civ_english?, builder? }`; `date` like "15th Granite, Year 5"; `builder` present only when the saga records a founder.
- `name_etymology[]` — `{ word, part? }` per name word (English root + part of speech).
- `battles[]` — site-scoped war events: `{ year?, type, attacker?, defender?, attacker_general?, defender_general?, outcome? }`; `type` is `WAR_ATTACKED_SITE | WAR_DESTROYED_SITE | WAR_SITE_NEW_LEADER`; `outcome` set when recorded (e.g. "site destroyed"). Most-recent-first.
- `battles_truncated?`, `battles_total?` — present only when the 20-row cap dropped entries.
- `notable_deaths[]` — `{ name, year?, race?, cause?, slain_by? }`; `race` is a creature token ("DWARF"), `cause` a df.death_type token ("BLEED"). Most-recent-first.
- `notable_deaths_truncated?`, `notable_deaths_total?` — present only when the 25-row cap dropped entries.

```json
{
  "site_id": 25,
  "site_name": "Geshud Nåzom",
  "site_name_english": "Fortress of Dreams",
  "site_type": "PlayerFortress",
  "pos": { "x": 5, "y": 4 },
  "current_year": 7,
  "age_years": 2,
  "founding": {
    "civ": "Uzoledzul",
    "civ_english": "The Oily Vestibule",
    "civ_id": 10,
    "date": "15th Granite, Year 5",
    "year": 5
  },
  "name_etymology": [
    { "part": "Noun", "word": "FORTRESS" },
    { "part": "NounPlural", "word": "DREAM" }
  ],
  "battles": [],
  "notable_deaths": [
    {
      "cause": "BLEED",
      "name": "Stukos Merchantage",
      "race": "DWARF",
      "slain_by": "Melbil Drillgorge",
      "year": 6
    }
  ]
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active, and `{"error":"no site loaded"}` if the site record cannot be found.
- Caps: battles 20, notable deaths 25, each most-recent-first; `*_truncated`/`*_total` appear ONLY when the cap actually dropped entries (optional keys, not always-false booleans).
- "Battles" means sieges fought AT this site; region-scoped `WAR_FIELD_BATTLE` events (no `.site` field) are intentionally excluded.
- "Notable" deaths require a NAMED historical figure — unnamed butchered livestock is skipped.
- A young fort with no war history degrades to empty battle/death lists (not an error).
- Names pass through CP437-to-UTF-8 conversion so accented proper nouns are valid JSON.
- Same-year events are tie-broken by saga insertion order for deterministic output (Lua table.sort is not stable).
- Verified live on DFHack 53.15; field paths are version-fragile and read through pcall throughout.

## Related
[chronicle](chronicle.md) · [artifacts_and_engravings](artifacts_and_engravings.md) · [fort_status](fort_status.md) · [citizen](citizen.md)
