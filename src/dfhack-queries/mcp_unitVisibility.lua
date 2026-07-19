--@ module = true
-- mcp_unitVisibility: the fog-of-war gate for UNIT enumeration.
--
-- Companion to mcp_readTerrain (which gates TERRAIN reads). Every terrain tool
-- honors designation.hidden; unit-listing tools must too, or the fort's fog of
-- war leaks through the back door -- an undiscovered cavern's wraiths are
-- reported as "on the map" even though no dwarf has ever seen them. That is an
-- X-ray: the agent learns the existence and count of hostiles the player
-- cannot see, breaking the facts-only doctrine as much as leaking real terrain
-- would.
--
-- is_hidden(u) is the SINGLE source of truth for "has the fort discovered the
-- tile this unit stands on". Any current or future sensor that enumerates
-- units (threats, fort_status, and any wildlife/animal-economy tool to come)
-- must reqscript this module and filter through it, rather than re-deriving
-- the designation.hidden check inline -- that duplication is exactly how the
-- original leak happened (isDanger/isCitizen predicate copy-pasted into two
-- files with no visibility gate at all).
--
-- A caged/chained beast is gated the same as a loose one: if its tile has
-- never been uncovered, the fort has not actually seen it (e.g. a forgotten
-- beast trapped in an undiscovered cavern), so it stays hidden. Off-map/
-- unloaded blocks are treated as unseen (fail closed, never leak).

-- Returns true when the unit's current tile is undiscovered (designation.hidden)
-- or off-map/unloaded. Mirrors mcp_readTerrain.read_window's per-tile check.
function is_hidden(u)
  local p = u.pos
  local blk = dfhack.maps.getTileBlock(p.x, p.y, p.z)
  if not blk then return true end -- off-map / unloaded => treat as unseen
  return blk.designation[p.x % 16][p.y % 16].hidden
end

-- When loaded via reqscript, stop here: the caller just wanted the functions.
if dfhack_flags and dfhack_flags.module then
  return
end
