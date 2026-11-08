local emit = reqscript('mcp_jsonOut').emit

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local sub = ({ ... })[1]

local function orders()
  local out = {}
  for _, o in ipairs(df.global.world.manager_orders.all) do
    out[#out + 1] = {
      id = o.id,
      job_type = df.job_type[o.job_type],
      reaction_name = o.reaction_name ~= '' and o.reaction_name or nil,
      amount_total = o.amount_total,
      amount_left = o.amount_left,
    }
  end
  table.sort(out, function(a, b) return a.id < b.id end)
  return out
end

if sub == 'orders' then
  emit({ orders = orders() })
elseif sub == 'fort' then
  emit({ fort_loaded = true })
else
  emit({ error = 'unknown mode: ' .. tostring(sub) })
end
