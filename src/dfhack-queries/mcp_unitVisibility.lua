--@ module = true
-- mcp_unitVisibility: see CONTRIBUTING.md "Shared internals: fog-of-war safety".

function is_hidden(u)
  local p = u.pos
  local blk = dfhack.maps.getTileBlock(p.x, p.y, p.z)
  if not blk then return true end
  return blk.designation[p.x % 16][p.y % 16].hidden
end

if dfhack_flags and dfhack_flags.module then
  return
end
