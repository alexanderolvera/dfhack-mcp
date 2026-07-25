--@ module = true
-- mcp_jsonOut: see CONTRIBUTING.md "Shared internals: DF text encoding".

local json = require('json')

local function convert(t)
  for k, v in pairs(t) do
    local ty = type(v)
    if ty == 'string' then t[k] = dfhack.df2utf(v)
    elseif ty == 'table' then convert(v) end
  end
end

function emit(t)
  convert(t)
  print(json.encode(t))
end

if dfhack_flags and dfhack_flags.module then
  return
end
