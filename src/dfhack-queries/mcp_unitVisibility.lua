--@ module = true
-- mcp_unitVisibility: see CONTRIBUTING.md "Shared internals: fog-of-war safety".

local terrain = reqscript('mcp_readTerrain')

function fog_gate(args)
  local gate = terrain.fog_gate(args)
  function gate.unit_hidden(u)
    local p = u.pos
    return gate.tile_hidden(p.x, p.y, p.z)
  end
  return gate
end

if dfhack_flags and dfhack_flags.module then
  return
end
