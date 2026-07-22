---
tool: citizen
tier: sensor
gated: none
source: src/tools/citizen.ts
lua: src/dfhack-queries/mcp_citizen.lua
tags: [dfhack-mcp/tool]
---

# citizen

> A deep dossier on ONE citizen, chained by unit_id from find_unit (or chronicle).

## Purpose
Where find_unit stays compact, this is the depth: one citizen's walkable social graph (spouse, parents, children, friends, grudges — each with a `unit_id` to pass back into citizen() and walk the graph), worshipped deities with worship strength, notable personality extremes, skills of note, likes/detests, physical highlights, and recent thoughts tied to current stress. An AI co-pilot calls it to understand why a dwarf is unhappy, who their relations are, or what they care about.

## Parameters
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| unit_id | string (all digits) | Yes | — | A live unit_id, e.g. from a find_unit match. |

## Returns
Top-level fields:
- `unit_id`, `name`, `profession?`, `sex?`, `age?`, `is_child?`
- `stress` — `{level, value?, longterm?}`
- `personality.extremes[]` — only top/bottom facets: `{facet, value (0-100), level (very low|low|high|very high)}`
- `relationships` — `spouse?`, `parents[]` (with `relation`: mother/father), `children[]`, `friends[]` (`affection`, `respect`, `meet_count?`), `grudges[]` (raw `love`/`trust`/`respect`/`loyalty`/`fear` plus `negative_dims` naming the negative bond dimensions), `friends_total`, `grudges_total`. Each edge carries `name` and, when the figure is a live unit, `unit_id`.
- `worship[]` — `{deity, strength? (0-100)}`
- `skills[]` — `{skill, level (Dabbling..Legendary), rating, rusty?}`
- `preferences` — `{likes[], detests[]}`
- `physical` — `{body_size_cm3?, size_modifier? (100 = average), build?}`
- `thoughts[]` — `{emotion?, about, severity?, year?}`; `about` is the game's raw thought-caption template, surfaced verbatim (may contain unfilled placeholders like [quality]/[deity]/[relation])

```json
{
  "age": 57,
  "name": "Tun Lolumavuz \"Woodenmines\", militia commander",
  "personality": {
    "extremes": [
      { "facet": "depression propensity", "level": "very high", "value": 100 }
    ]
  },
  "physical": { "body_size_cm3": 6950, "build": "average build", "size_modifier": 98 },
  "preferences": {
    "detests": ["lizard"],
    "likes": ["periclase", "electrum", "weapon", "gloves", "river spirits"]
  },
  "profession": "militia commander",
  "relationships": {
    "children": [],
    "friends": [
      { "affection": 95, "meet_count": 39, "name": "Cog Notchanvils", "respect": 0, "unit_id": 115 }
    ],
    "friends_total": 12,
    "grudges": [],
    "grudges_total": 0,
    "parents": []
  },
  "sex": "male",
  "skills": [
    { "level": "Accomplished", "rating": 10, "skill": "situational awareness" }
  ]
}
```

## Caveats & limits
- List caps (from the Lua): 8 friends, 8 grudges, 10 skills, 12 likes + 12 detests, 10 most-recent thoughts. `friends_total`/`grudges_total` always carry the full counts.
- A relation's `unit_id` is absent when the figure is dead, off-map, or not a live unit — the name is still reported.
- Friends are positive-affection acquaintances; grudges are bonds gone negative with no positive love to offset them — raw scores plus `negative_dims`, as labeled facts.
- Thought captions are surfaced verbatim as game data, not reworded; unfilled DF placeholders can appear.
- Personality reports only notable extremes, never the full 50-facet dump.
- Empty categories degrade to `[]`; a missing field is a labeled fact, not a traceback (defensive reads in the Lua).
- Returns `{"error":...}` for a missing unit_id, `{"error":"no fort loaded"}` if no fort is active.

## Implementation notes
- `friends[].affection` is the citizen relationship's core "love" score, surfaced under the `affection` name.
- `grudges[].negative_dims` only checks love/trust/respect/loyalty for negative values — `fear` is reported alongside but never contributes to `negative_dims`.
- Nested list fields (e.g. `relationships.friends`, `worship`, `skills`) are addressed by dot path and coerced back to arrays in the TS wrapper: an empty Lua table encodes as `{}` rather than `[]`, and the generic `runJsonScript` helper only normalizes top-level fields, not citizen's nested ones.
- Field paths, probed live on DFHack 53.15-r2: `unit.status.current_soul.personality.traits[i]` (0-100, indexed by `df.personality_facet_type`); `.personality.emotions[]` (`{type=df.emotion_type, thought=df.unit_thought_type, subthought, severity, year, year_tick}`, appended chronologically — entries with `thought < 0` are stress-decay artifacts and are skipped, so `thoughts[]` takes the tail of the real ones); `.personality.stress`/`.longterm_stress` plus `dfhack.units.getStressCategory`; `soul.skills[]` (`{id=df.job_skill, rating=df.skill_rating, rusty}`); `soul.preferences[]` (`df.unitpref_type`, where `HateCreature` maps to `detests` and everything else to `likes`, with targets resolved via `matinfo`/`raws.creatures`/`raws.descriptors`/`raws.plants`).
- Relationship resolution: spouse prefers the live `unit.relationship_ids.Spouse` unit_id, falling back to the histfig `SPOUSE` link for an off-map or deceased spouse; parents/children come from `hf.histfig_links` `MOTHER`/`FATHER`/`CHILD` entries resolved to `target_hf`, then mapped to a live unit via `df.historical_figure.find(hf).unit_id` (nil when not currently alive/loaded); worship comes from the histfig `DEITY` link (`target_hf` name + `link_strength`, 0-100); friends/grudges come from `hf.info.relationships.hf_visual[]`, which carries per-figure core scores (`love`, `trust`, `respect`, `loyalty`, `fear`) plus `meet_count` — a relation the dwarf still loves (`love > 0`) is classified a friend even if another dimension (e.g. trust) is negative, since the raw scores are reported either way; family figures are excluded from both the friends and grudges lists.
- `physical.body_size_cm3`/`size_modifier` read `unit.body.size_info.size_cur` and `unit.appearance.size_modifier` (100 = average build).
- Every version-fragile field above is read through a pcall-wrapped `safe()` helper, so a raws/struct change on a future DF build degrades to a default value rather than a crash.

## Related
- [find_unit](find_unit.md) — the compact search that yields the `unit_id` to chain here.
- [unmet_needs](unmet_needs.md) ↔ [moods](moods.md) — the fort-wide view of what this dossier shows per dwarf.
- [injuries_and_health](injuries_and_health.md) — the medical side of a citizen's condition.
- [chronicle](chronicle.md) — events that explain recent thoughts.
