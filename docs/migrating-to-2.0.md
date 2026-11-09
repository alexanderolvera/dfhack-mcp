# Migrating to 2.0

dfhack-mcp 2.0 is a DFHack access layer: it reports facts and executes what it is told. Anything that curated knowledge or judged which facts matter has moved out to the client. This page lists every removed tool and field, and where its information now lives.

## Removed tools

| Removed | Use instead |
| --- | --- |
| `wiki_search`, `wiki_lookup` | Your own game-knowledge source: a curated offline knowledge base, or your own wiki client. They were plain HTTP to dwarffortresswiki.org and never touched DFHack. `DFHACK_MCP_CACHE_DIR` is gone with them. The MediaWiki-to-text cleaner (`cleanHtml` in `src/wiki/clean.ts` in 1.x) is worth lifting into a client. |
| `identify` | `game_data`. It takes the same `query` (creature token, name fragment, or live `unit_id`), and its creature dossier carries every fact `identify` returned (`flags[]`, `attacks[]`, `interactions[]`). Choosing which strategy text fits a creature is now the client's call. |

## `alerts[]` removed from 13 tools

`environment`, `fort_status`, `injuries_and_health`, `jobs_and_labor`, `mandates_and_justice`, `map_overview`, `military`, `moods`, `petitions`, `rooms_and_zones`, `threats`, `trade` and `unmet_needs` no longer return `alerts`. Each alert restated a field in the same response once a threshold the server chose was crossed. Read the field and apply your own threshold. Two facts were only ever visible inside an alert, so they are now fields: `fort_status.hostiles_on_map` and `rooms_and_zones.ghosts.active_total`.

| Tool | Removed alert | Threshold / constant | Read instead |
|---|---|---|---|
| environment | "surface water is frozen" | none | `surface.water_frozen` |
| environment | "evil biome" | none | `biome.evil` |
| environment | "reanimating biome: the dead reanimate" | none | `biome.reanimating` |
| environment | "cavern N is open to fort pathing" | none | `caverns[].open_to_fort` |
| fort_status | "N dwarves unhappy (P% of pop)" | `UNHAPPY_MIN_ALERT = 3` and `UNHAPPY_FRACTION_ALERT = 0.10` | `happiness.unhappy` / `population` |
| fort_status | "N hostiles on map" | `> 0` | **new** `hostiles_on_map` |
| fort_status | "N citizen deaths since year Y (causes)" | `> 0` | `recent_deaths.citizens`, `.since_year`, `.citizen_causes[]` |
| fort_status | "N of those citizens were slain by another citizen" | `> 0` | `recent_deaths.citizens_slain_by_citizen` |
| injuries_and_health | "N dwarves unconscious (P% of pop)" | `UNCONSCIOUS_MIN_ALERT = 3` and `UNCONSCIOUS_FRACTION_ALERT = 0.10` | `unconscious` / `population` |
| jobs_and_labor | "I of A working-age dwarves idle (P%)" | `IDLE_FRACTION_ALERT = 0.30` | `idle`, `workforce`, `idle_pct` |
| jobs_and_labor | "Nx job cancellation: reason" | `CANCEL_SPAM_ALERT = 10` | `cancellations.by_reason[0]` |
| mandates_and_justice | "noble's mandate (make N item) has R left, D day(s) to deadline" | `DEADLINE_SOON = 7` | `mandates[].remaining`, `.deadline_days` |
| mandates_and_justice | "N unmet noble room demands" | `> 0` | `demands[]` (`demands_truncated`) |
| mandates_and_justice | "N prison sentences pending, F free restraints" | sentences > free restraints | `justice.prison_sentences`, `justice.restraints_free` |
| map_overview | "fort core column is not open to sky (surface_z_at_core unknown)" | none | `fort_core` non-null and `surface_z_at_core === null` (the TS wrapper already normalizes the omitted value to `null`, and the description documents null as "not under open sky") |
| military | "no military squads — the fort is undefended" | `squad_count == 0` | `squad_count` |
| military | "NO defenders against a great-danger creature (N on map, 0 soldiers)" | great danger > 0 and soldiers == 0 | `great_danger_on_map`, `soldiers` |
| military | "name (squad) has an incomplete uniform" (one per soldier) | none | `squads[].roster[].uniform_complete` (plus `uniform[]` gaps) |
| moods | "name demands material but the fort has none in stock" | `have == 0` and `gathered < needed` | `active[].demands[].have`, `.gathered`, `.needed` |
| petitions | "petitioner's building petition is ready to establish but still outstanding (N days)" | none | `location_petitions[].warned_ready`, `.status`, `.age_days` |
| petitions | "petitioner's kind petition has D day(s) left to decide" | `DEADLINE_SOON = 7` | `residency_petitions[].deadline_days`, `.status` |
| petitions | "N petition(s) awaiting a decision" | `> 0` | `awaiting_decision_count` |
| rooms_and_zones | "N adults without an assigned bedroom" | `> 0` | `bedrooms.adults_without` |
| rooms_and_zones | "N dead awaiting burial, F free coffins" | dead > free coffins | `dead_unburied`, `coffins_free` |
| rooms_and_zones | "N worshipped deities without a dedicated temple" | `> 0` | `temples.needed_by_worshippers[]` |
| rooms_and_zones | "N[+] active ghosts" | `> 0` | **new** `ghosts.active_total` (with `ghosts.active[]`, `ghosts.active_truncated`) |
| threats | "N great-danger creatures loose (...); traits: ..." | `> 0` | `groups[]` where `great_danger && !contained`: sum `count`, union `traits` |
| threats | "N invaders on map" | `> 0` | `groups[]` where `invader && !great_danger && !contained`: sum `count` |
| threats | "N other hostiles on map" | `> 0` | remaining non-contained `groups[]`: sum `count` |
| trade | "trade depot is not wagon-accessible" | none | `depot.exists`, `depot.accessible` |
| trade | "caravan at depot with no broker assigned" | none | `caravans[].state == "AtDepot"`, `broker.assigned` |
| trade | "caravan at depot, broker not at the depot" | none | `caravans[].state == "AtDepot"`, `broker.at_depot` |
| unmet_needs | "N of P dwarves distracted by unmet need: need" | `NEED_SHARE_ALERT = 0.25` | `top_needs[0].dwarves` / `population` |

## `stocks`: days-of-supply and notable lists removed

`stocks` returns raw counts, with `population` alongside, so a client can apply its own per-dwarf rates. The new `inventory` section has the usable count of every `df.item_type` token, and `category` narrows it to one token.

| Removed | Read instead |
| --- | --- |
| `food_days` (assumed 2 food per dwarf per season) | `counts.food` and `population` |
| `drink_days` (assumed 5 drinks per dwarf per season) | `counts.drink` (= `inventory.DRINK`) and `population` |
| `notable_low` (food/drink under 14 days, fuel < 5, wood < 20, cloth < 10) | `counts.food`, `.drink`, `.fuel`, `.wood`, `.cloth` against your own thresholds |
| `notable_high` (stone > 500) | `counts.stone` (= `inventory.BOULDER`) |

## Fog of war: one `reveal_hidden` opt-in

Fog of war is still on by default. Every fog-gated tool now takes the same optional `reveal_hidden: boolean` (`defenses`, `environment`, `fluids`, `fort_health`, `fort_status`, `geology`, `historical_figure`, `livestock_and_pastures`, `map_overview`, `military`, `rooms_and_zones`, `threats`, `tile_region`, `unit_appearance`), and every response from one of them carries `fog_of_war: "applied" | "bypassed"`. The default responses are unchanged apart from that new field.

`geology` already had a `reveal_hidden` before 2.0, with its own response shape. It now works like the rest: a bypassed survey has the same fields as a default one, computed as if the whole map were discovered.

| Before 2.0, with `reveal_hidden: true` | 2.0 |
| --- | --- |
| `reveal_hidden: true` in the response | `fog_of_war: "bypassed"` |
| `caverns_hidden[]` (undiscovered caverns, listed apart) | merged into `caverns_discovered[]`, which lists every cavern when bypassed |
| `magma_hidden { z_top, z_bottom }` (undiscovered magma sea) | `magma_reached: true` when the sea exists. Its z-range is no longer reported; `fluids` with `reveal_hidden: true` gives `magma_sea.top_z`. |
| layer stack ran the full column; surface facts read revealed tiles only | layer stack runs the full column, and `surface_z_max`, brook, river, murky pools and cavern water also read undiscovered tiles |

## Errors carry a `code`

Every error payload now has a stable `code` alongside the `error` message: `NOT_CONNECTED`, `NO_FORT`, `NO_GAME`, `NOT_FOUND`, `INVALID_ARGUMENT`, `TIMEOUT` or `SCRIPT_ERROR`. Branch on `code`; the message text may change between releases. Arguments that fail a tool's input schema are still rejected by the MCP SDK before the tool runs, as a plain-text protocol error with no `code`.

Each call now has a deadline (`DFHACK_MCP_TIMEOUT_MS`, default 10000). A call that misses it returns `TIMEOUT` and is never retried, because the script may have partly run.

## Knowing what DF is doing without a fort

`fort_status` is no longer the way to probe whether a fort is loaded. `game_state` works at any screen. It reports versions, mode, whether a world and map are loaded, pause state and the raw clock, plus the world and site `identity` a client can use as a key for a fort.
