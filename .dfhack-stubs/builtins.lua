---@meta
-- =============================================================================
-- DFHack runtime globals + bundled modules that mcp_*.lua rely on.
--
-- SOURCE OF TRUTH: DFHack 53.15-r2
--   library/lua/dfhack.lua   (reqscript @ line 1031, exported global @ 1034)
--   library/lua/json.lua     (require('json') -> { encode, decode, ... })
--
-- These are the DFHack-injected globals lua-language-server would otherwise
-- flag as undefined in a bare .lua file. Signatures transcribed from the pinned
-- DFHack Lua library. Curated to what the query layer uses.
-- =============================================================================

---@class json_module
---@field encode fun(value: any, options?: table): string
---@field decode fun(str: string, options?: table): any
---@field encode_file fun(value: any, path: string, options?: table)
---@field decode_file fun(path: string, options?: table): any

-- reqscript: load another DFHack script as a module (used to share
-- mcp_readTerrain across the spatial tools). library/lua/dfhack.lua:1031.
---@param name string
---@return table
function reqscript(name) end

-- DFHack overrides `require` so that require('json') resolves to the bundled
-- library/lua/json.lua. Narrow the 'json' case; fall through to any otherwise.
---@param modname 'json'
---@return json_module
---@overload fun(modname: string): any
function require(modname) end

-- Debug pretty-printers injected into the global env by DFHack.
---@param value any
function printall(value) end

---@param value any
function printall_recurse(value) end
