---
tags: [dfhack-mcp/tool, index]
---

# Tool Index — dfhack-mcp

One note per MCP tool (38 tools: 27 sensors, 4 reference, 6 gated actuators, 1 dev), tracking `src/tools/registry.ts`. Each note carries frontmatter (`tool` / `tier` / `gated` / `source` / `lua`), parameters from the zod schema, the real return shape from the Lua query, and a trimmed example from the frozen-fixture goldens where one exists.

Doctrine reminder: every tool is **facts-only** — it senses and reports; judgment stays with the AI client. Actuators are gated behind `DFHACK_MCP_ACTUATORS` and follow the §A0 preview/confirm contract; `run_lua` is dev-gated behind `DFHACK_MCP_DEV`.

## Sensors (27)

*Fort & dwarves*
- [fort_status](fort_status.md) — one-call situational overview; canonical "is a fort loaded" probe
- [fort_health](fort_health.md) — FPS/GFPS, item clutter by category, unit counts — the fort's computational health
- [citizen](citizen.md) — deep dossier on one dwarf
- [find_unit](find_unit.md) — name/profession search → unit ids
- [unmet_needs](unmet_needs.md) — need fulfillment across the fort
- [moods](moods.md) — strange moods and their countdowns
- [injuries_and_health](injuries_and_health.md) — wounded, diagnoses, healthcare flow
- [jobs_and_labor](jobs_and_labor.md) — active jobs and idlers
- [work_details](work_details.md) — work-detail assignments (the labor read)

*Threats & military*
- [threats](threats.md) — hostile groups with tactical traits
- [defenses](defenses.md) — fortifications, traps, perimeter read
- [military](military.md) — squads and readiness

*Economy & society*
- [stocks](stocks.md) — food/booze/materials counts
- [stockpiles](stockpiles.md) — per-pile settings/links/fullness, unstored and rotting-item backlog
- [farming](farming.md) — farm plots, crop assignment by season, seed stock
- [trade](trade.md) — depot, broker, caravan state
- [work_order_list](work_order_list.md) — manager work-order queue
- [mandates_and_justice](mandates_and_justice.md) — nobles' mandates, crime, punishments
- [nobles_and_administrators](nobles_and_administrators.md) — appointed positions and vacancies
- [rooms_and_zones](rooms_and_zones.md) — bedrooms, temples, civzones, burial
- [petitions](petitions.md) — location and residency/citizenship petitions awaiting decision
- [hauling_routes](hauling_routes.md) — minecart hauling routes, stops, vehicles
- [livestock_and_pastures](livestock_and_pastures.md) — tame animals, pastures, cages, slaughter
- [artifacts_and_engravings](artifacts_and_engravings.md) — artifacts and engraving coverage
- [chronicle](chronicle.md) — recent events via the report stream (cursor-paginated)
- [site_history](site_history.md) — this site's world-gen and post-embark history

*Earthworks (spatial)*
- [map_overview](map_overview.md) — cheap spatial orientation
- [tile_region](tile_region.md) — bounded z-level tile read
- [geology](geology.md) — embark geological survey
- [environment](environment.md) — season, weather, temperature, biome, cavern pathing
- [fluids](fluids.md) — aquifers, water/magma bodies, flood exposure, well source depth

## Reference (4)

- [game_data](game_data.md) — this world's raws: six dossier kinds (creature/material/plant/reaction/item/building)
- [identify](identify.md) — one-call raws + wiki fusion for a named creature
- [wiki_search](wiki_search.md) — DF2014 wiki search
- [wiki_lookup](wiki_lookup.md) — DF2014 wiki page as clean cached text

## Actuators (6, gated)

- [work_order_create](work_order_create.md) / [work_order_cancel](work_order_cancel.md) — manager work orders
- [blueprint_apply](blueprint_apply.md) / [blueprint_undo](blueprint_undo.md) — quickfort-style dig blueprints
- [assign_work_detail](assign_work_detail.md) — put a dwarf on/off a work detail
- [game_save](game_save.md) — checkpoint the fort with a quicksave

## Dev (1)

- [run_lua](run_lua.md) — raw Lua escape hatch (dev-gated, never exposed by default)

## Composition map

Typical co-pilot flows these notes cross-link:
- Orient: [fort_status](fort_status.md) → [chronicle](chronicle.md) → drill-downs
- Threat triage: [threats](threats.md) → [identify](identify.md) → [defenses](defenses.md) / [military](military.md)
- Production: [stocks](stocks.md) → [work_order_list](work_order_list.md) → [work_order_create](work_order_create.md)
- Labor: [jobs_and_labor](jobs_and_labor.md) → [work_details](work_details.md) → [assign_work_detail](assign_work_detail.md)
- Digging: [map_overview](map_overview.md) → [tile_region](tile_region.md) / [geology](geology.md) / [fluids](fluids.md) → [blueprint_apply](blueprint_apply.md)
- Before a risky change: [game_save](game_save.md) → the actuator in question
