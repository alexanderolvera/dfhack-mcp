---@meta
-- =============================================================================
-- DFHack `dfhack` module API — EmmyLua type stubs for lua-language-server.
--
-- SOURCE OF TRUTH: DFHack docs, tag 53.15-r2
--   docs/dev/Lua API.rst  (signatures transcribed verbatim; line refs below)
--
-- WHY HAND-AUTHORED (flagged, version-fragile): dfhack.units.*, dfhack.maps.*,
-- and dfhack.translation.* are C++ module functions bound at runtime — DFHack
-- ships NO static Lua definition for them (library/lua/dfhack/ only contains
-- buildings.lua + workshops.lua). This is a CURATED SUBSET: only the functions
-- src/dfhack-queries/mcp_*.lua actually call. Signatures are FACTS from the
-- pinned Lua API.rst, not invented. Re-derive on the next DFHack bump.
-- =============================================================================

---@class dfhack.units
local units = {}

-- Lua API.rst:1730  getCitizens([exclude_residents[,include_insane]])
---@param exclude_residents? boolean
---@param include_insane? boolean
---@return df.unit[]
function units.getCitizens(exclude_residents, include_insane) end

---@param unit df.unit
---@param include_insane? boolean
---@return boolean
function units.isCitizen(unit, include_insane) end -- Lua API.rst:1505

---@param unit df.unit
---@return boolean
function units.isActive(unit) end -- Lua API.rst:1497

---@param unit df.unit
---@return boolean
function units.isDead(unit) end -- Lua API.rst:1540

---@param unit df.unit
---@return boolean
function units.isDanger(unit) end -- Lua API.rst:1692

---@param unit df.unit
---@return boolean
function units.isGreatDanger(unit) end -- Lua API.rst:1698

---@param unit df.unit
---@return boolean
function units.isBaby(unit) end -- Lua API.rst:1573

---@param unit df.unit
---@return boolean
function units.isChild(unit) end -- Lua API.rst:1574

---@param unit df.unit
---@param hiding_curse? boolean
---@return boolean
function units.isUndead(unit, hiding_curse) end -- Lua API.rst:1678

---@param unit df.unit
---@return boolean
function units.isInvader(unit) end -- Lua API.rst:1674

---@param unit df.unit
---@return boolean
function units.isCrazed(unit) end -- Lua API.rst:1554

-- Lua API.rst:1854  getReadableName(unit or histfig[, skip_english])
---@param unit df.unit
---@param skip_english? boolean
---@return string
function units.getReadableName(unit, skip_english) end

-- Lua API.rst:1926  getProfessionName(unit[,ignore_noble[,plural[,land_title]]])
---@param unit df.unit
---@param ignore_noble? boolean
---@param plural? boolean
---@param land_title? boolean
---@return string
function units.getProfessionName(unit, ignore_noble, plural, land_title) end

---@param unit df.unit
---@return string
function units.getStressCategory(unit) end -- Lua API.rst:1992

-- Lua API.rst:1865  getAge(unit[, true_age])
---@param unit df.unit
---@param true_age? boolean
---@return number
function units.getAge(unit, true_age) end

---@class dfhack.maps
local maps = {}

-- Lua API.rst:2397  getTileBlock(coords) | getTileBlock(x,y,z)
---@param x integer
---@param y integer
---@param z integer
---@return df.map_block?
function maps.getTileBlock(x, y, z) end

-- Lua API.rst:2406  getTileType(coords) | getTileType(x,y,z)
---@param x integer
---@param y integer
---@param z integer
---@return integer? # tiletype id, index into df.tiletype.attrs
function maps.getTileType(x, y, z) end

-- Lua API.rst:2448  getWalkableGroup(pos)
---@param pos { x: integer, y: integer, z: integer }
---@return integer
function maps.getWalkableGroup(pos) end

---@class dfhack.translation
local translation = {}

-- Lua API.rst:1057  translateName(name[,in_english[,only_last_name]])
---@param name any # df.language_name
---@param in_english? boolean
---@param only_last_name? boolean
---@return string
function translation.translateName(name, in_english, only_last_name) end

---@class dfhack
---@field units dfhack.units
---@field maps dfhack.maps
---@field translation dfhack.translation
dfhack = {}
