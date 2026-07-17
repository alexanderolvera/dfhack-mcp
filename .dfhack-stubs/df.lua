---@meta
-- =============================================================================
-- DFHack `df` global — EmmyLua type stubs for lua-language-server (LLS).
--
-- SOURCE OF TRUTH: DFHack df-structures XML, tag 53.15-r2
--   library/xml/df.creature.xml  (creature_raw @ line 1485, caste_raw @ 1006)
--   library/xml/df.world.xml, df.units.xml, df.item.xml, df.building.xml, ...
--   + the runtime `df.<enum>` tables materialised from the same XML.
--
-- WHY HAND-AUTHORED (flagged, version-fragile): DFHack 53.15-r2 does NOT ship
-- lua-language-server definitions for the generated `df.*` global — that
-- namespace is built at runtime from the df-structures XML, so there is no
-- static file to vendor. These stubs are a CURATED SUBSET covering only the
-- exact field paths that src/dfhack-queries/mcp_*.lua touch. They are FACTS
-- transcribed from the pinned XML, not a complete df.* type set; unlisted
-- fields simply won't autocomplete. When the DF/DFHack build bumps, re-derive
-- against the new df-structures tag (see .dfhack-stubs/README.md).
-- =============================================================================

--#region enums (df.<enum>.TOKEN)

---@class df.game_mode
---@field NONE integer
---@field DWARF integer
---@field ADVENTURE integer

---@class df.need_type
---@class df.job_type
---@class df.trap_type
---@class df.building_type
---@class df.item_type
---@class df.tiletype_shape
---@class df.creature_raw_flags
---@class df.caste_raw_flags

---@class df.builtin_mats
---@field COAL integer

---@class df.tiletype_static
---@field attrs table<integer, df.tiletype_attr> # df.tiletype.attrs[tiletype_id]

---@class df.tiletype_attr
---@field shape integer # index into df.tiletype_shape

--#endregion

--#region df-structures record types (subset in active use)

---@class df.creature_raw
---@field creature_id string           # raw token, e.g. "DWARF" / "DEMON_4"
---@field name string[]                # [0]=singular [1]=plural [2]=adjective
---@field adultsize integer            # body volume, cm^3 (var_l_GENERAL_SIZE)
---@field caste df.caste_raw[]         # NB: field is `caste`, NOT `castes`
---@field flags table<string, boolean> # df-flagarray, index-enum creature_raw_flags

---@class df.caste_raw
---@field caste_name string[]          # [0]=singular [1]=plural [2]=adjective
---@field description string
---@field flags table<string, boolean> # index-enum caste_raw_flags
---@field body_info df.body_info

---@class df.body_info
---@field attacks df.body_detail_plan_attack[]
---@field interactions df.caste_body_info_interaction[]

---@class df.body_detail_plan_attack
---@field name string
---@field verb_3rd string

---@class df.caste_body_info_interaction
---@field interaction df.interaction_ref
---@field material_str string[]        # emitted material token parts

---@class df.interaction_ref
---@field adv_name string

---@class df.unit
---@field id integer
---@field race integer                 # indexes df.global.world.raws.creatures.all

---@class df.squad
---@field id integer

---@class df.building
---@field id integer

---@class df.item
---@field id integer

--#endregion

--#region containers hung off df.global.world

---@class df.world_raws
---@field creatures df.world_raws.T_creatures

---@class df.world_raws.T_creatures
---@field all df.creature_raw[]

---@class df.world.T_units
---@field active df.unit[]

---@class df.world.T_squads
---@field all df.squad[]

---@class df.world.T_buildings
---@field all df.building[]

---@class df.world.T_items
---@field other df.world.T_items.T_other

---@class df.world.T_items.T_other
---@field IN_PLAY df.item[]

---@class df.world_data
---@field active_site df.world_site[]

---@class df.world_site
---@field id integer

---@class df.map_block_column

---@class df.world
---@field raws df.world_raws
---@field units df.world.T_units
---@field squads df.world.T_squads
---@field buildings df.world.T_buildings
---@field items df.world.T_items
---@field map df.map_block_column
---@field world_data df.world_data

---@class df.plotinfost.T_tasks.T_wealth
---@field total integer

---@class df.plotinfost.T_tasks
---@field wealth df.plotinfost.T_tasks.T_wealth

---@class df.plotinfost.T_main
---@field fortress_entity df.historical_entity

---@class df.historical_entity
---@field id integer

---@class df.plotinfost
---@field main df.plotinfost.T_main
---@field tasks df.plotinfost.T_tasks

---@class df.global_type
---@field world df.world
---@field plotinfo df.plotinfost
---@field gamemode integer             # value from df.game_mode
---@field cur_year integer
---@field cur_year_tick integer

--#endregion

--#region the `df` global itself

---@class df.unit_static
---@field find fun(id: integer): df.unit? # df.unit.find(unit_id)

---@class df
---@field global df.global_type
---@field game_mode df.game_mode
---@field need_type df.need_type
---@field job_type df.job_type
---@field trap_type df.trap_type
---@field building_type df.building_type
---@field item_type df.item_type
---@field tiletype_shape df.tiletype_shape
---@field creature_raw_flags df.creature_raw_flags
---@field caste_raw_flags df.caste_raw_flags
---@field builtin_mats df.builtin_mats
---@field tiletype df.tiletype_static
---@field unit df.unit_static
df = {}

--#endregion
