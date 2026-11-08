---
tool: dfhack_command_run
tier: commands
gated: commands
source: src/tools/dfhackCommand.ts
lua: src/dfhack-queries/mcp_dfhackCommand.lua
tags: [dfhack-mcp/tool]
---

# dfhack_command_run

> Run one of DFHack's own commands from a small, hand-reviewed allowlist.

## Purpose
A general path to DFHack's built-in commands, plugins, and scripts, limited to command lines this project has reviewed. EXECUTE-NEVER-DECIDE: it runs exactly the command line given or refuses it, and never suggests a command. Anything not on the allowlist returns `{"error":"not allowlisted"}` and is never forwarded to DFHack. Discovery is [dfhack_command_list](dfhack_command_list.md), which reports DFHack's full `ls` surface; this tool is deliberately narrower than what that one can see.

Entries are matched **per subcommand**, because one command can have both a query form and a mutating form (`instruments list` vs. `instruments order`):

- **Read-only** entries run directly and return the console output.
- **Mutating** entries use the shared §A0 dry-run/confirm loop (`src/actuator.ts`). A call without `confirm_token` previews the state the command will act on and mints a single-use token. A second call with the same arguments and the token runs it.

## Gate
Registered only when `DFHACK_MCP_COMMANDS=1`. This gate is separate from `DFHACK_MCP_ACTUATORS`: each actuator was hand-built with a native preview and a documented reversal, while this tool passes command lines to DFHack, so it carries a different risk. Neither gate enables the other.

## The allowlist
Source: `ALLOWLIST` in `src/tools/dfhackCommandAllowlist.ts`. One entry per subcommand form, each with a one-line safety/reversibility note, so growing the list is a one-entry change.

| Entry | Usage | Access | Note |
|---|---|---|---|
| `seedwatch status` | `seedwatch [status]` | read | pure query: enabled state, watch list, usable seed counts |
| `seedwatch set` | `seedwatch <PLANT_ID\|all> <target>` | mutate | sets one (or all) seed targets, 0 removes the type; reversible by re-setting the prior targets reported in undo |
| `seedwatch clear` | `seedwatch clear` | mutate | removes every type from the watch list; reversible by re-setting the prior targets reported in undo |
| `enable seedwatch` | `enable seedwatch` | mutate | starts seedwatch; on a fresh fort it watches every seed at target 30; reversible with disable seedwatch plus the reported target restores |
| `disable seedwatch` | `disable seedwatch` | mutate | stops seedwatch toggling cookability; the watch list is kept; reversible with enable seedwatch |
| `instruments list` | `instruments [list]` | read | pure query of this world's instrument raws (skills, materials, handheld vs. building) |
| `instruments order` | `instruments order <instrument_name> [<quantity>]` | mutate | creates manager work orders for the instrument and each component; reversible by cancelling the reported order ids, items already made stay |
| `prospect` | `prospect [-s\|--show <sections>] [-v\|--values]` | read | pure query of the revealed map only; the all/hell keywords (which scan undiscovered tiles) are not allowlisted |

Matching is exact: the command name is case-sensitive, every argument must fit its slot (`PLANT_ID` is `[A-Za-z0-9_]+`, counts are non-negative integers, an instrument name can't start with `-`), and extra arguments are rejected. Arguments go to DFHack as an argv array, not a shell string, so they can't chain a second command.

## Parameters
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `command` | string | yes | — | DFHack command name, e.g. `seedwatch`, `instruments`, `enable` |
| `args` | string[] | no | `[]` | arguments, one per element, e.g. `["MUSHROOM_HELMET_PLUMP", "50"]` |
| `confirm_token` | string | no | — | mutating entries only: omit to DRY-RUN, pass the returned token to APPLY |

## Returns
**Not allowlisted:** `{error: "not allowlisted", command, args, allowlist: [{id, usage, access, note}]}`.

**Read-only entry:** `{allowlist_entry, access: "read", command_line, command_result: "CR_OK", output}`, where `output` is DFHack's console text verbatim.

**Command failed** (DFHack returned a non-OK result): `{error: "command failed", command, args, command_result, output}`. `command_result` is DFHack's `command_result` name (`CR_WRONG_USAGE`, `CR_FAILURE`, `CR_NOT_FOUND`, `CR_NOT_IMPLEMENTED`, …), and `output` is the console text it printed (for `CR_WRONG_USAGE` this is the command's help).

**Mutating entry, dry-run:** `{mode: "preview", applied: false, preview, confirm_token}`. `preview` holds `{allowlist_entry, command_line, note, native_dry_run: false}` plus:
- seedwatch entries: `seedwatch_now: {enabled, targets: [{plant, usable, target}]}`, the state the command acts on.
- `instruments order`: `quantity`, `instrument` (that instrument's lines from `instruments list`: its kind, assembly skill, and each component with its skill and material), and `manager_orders_now` (the current order count).

If the instrument isn't in `instruments list`, the preview has `blocked: [...]` and no token is minted.

**Mutating entry, apply:** `{mode: "apply", applied: true, changes, undo, readback}`:

```json
{
  "mode": "apply",
  "applied": true,
  "changes": {
    "allowlist_entry": "instruments order",
    "command_line": "instruments order il 2",
    "output": "Queuing CustomReaction 'MAKE_ENT10 INK1_KEYBOARD' x2\nQueuing CustomReaction 'MAKE_ENT10 INK1_BODY' x2\nQueuing CustomReaction 'MAKE_ENT10 INK1_BELLOWS' x2\nQueuing CustomReaction 'MAKE_ENT10 INK1' x2\n\nCreated 4 work orders\n"
  },
  "undo": {
    "reversible": true,
    "via": "work_order_cancel",
    "order_ids": [494, 495, 496, 497],
    "note": "cancelling removes the orders; items they already produced stay"
  },
  "readback": {
    "orders_created": [
      { "id": 494, "job_type": "CustomReaction", "reaction_name": "MAKE_ENT10 INK1_KEYBOARD", "amount_total": 1, "amount_left": 1 }
    ]
  }
}
```
*(live run against the fixture fort, `readback` trimmed to one order.)*

For seedwatch entries, `undo` is `{reversible: true, via: "dfhack_command_run", commands: [{command, args}]}`: the command lines that return every changed target, and the enabled state, to what it was before. It is computed by diffing `seedwatch status` before and after the run, so `commands: []` means the run changed nothing. Example: `seedwatch NOT_A_PLANT 5` returns `CR_OK` with output `NOT_A_PLANT has not been found as a material.` and an empty undo. `readback.seedwatch` is the state after the run.

## Caveats & limits
- **No native dry-run.** DFHack has no preview for any of these mutating commands. The preview reports the current state the command acts on, not a simulation of its effect; the apply result reports what actually changed.
- **Token scope.** For seedwatch, the token is bound to the enabled flag and every target, and seed counts are excluded, so a change to the watch list voids it but cooking doesn't. For `instruments order`, it is bound to the instrument's raws lines.
- **`instruments order` undo needs the actuator gate.** `work_order_cancel` is registered only under `DFHACK_MCP_ACTUATORS`. Cancel every reported id together: the final assemble order carries order conditions that reference the component orders. `undo.order_ids` is the diff of manager order ids before and after the run, so an order the player creates during that call would show up in it too.
- **Instrument names come from DFHack's console text**, which is CP437. A name with non-ASCII letters may not match in `instruments list`; the preview then reports it as blocked.
- `prospect` scans only the revealed map. The `all`/`hell` keywords, which scan undiscovered tiles, are refused, the same fog-of-war line every other tool keeps.
- The no-fort check applies to mutating entries only (`{"error":"no fort loaded"}` from `mcp_dfhackCommand.lua`). Read-only entries run as DFHack runs them and report whatever DFHack prints.

## Implementation notes
- `RunCommand` (the RPC behind every `mcp_*.lua` call) runs built-ins, plugins, and scripts alike; `runDfhackCommand` in `src/dfclient.ts` calls it with the command's own name instead of the `mcp_` prefix, under the same reconnect-once rule.
- When a command returns a non-OK `command_result`, DFHack replies with a FAIL frame. `dfhack-remote-node` raises that as `RpcError`, with `code` set to the `command_result` and `text` set to the console output, and the tool reports both as a fact. Some commands report a problem in their output and still return `CR_OK`. That output is passed through unchanged.
- `mcp_dfhackCommand.lua` has two modes: `fort` (the no-fort guard) and `orders` (manager orders as `{id, job_type, reaction_name, amount_total, amount_left}`, id-sorted, for the before/after diff).

## Related
[dfhack_command_list](dfhack_command_list.md) (discover commands), [work_order_cancel](work_order_cancel.md) (reverse `instruments order`), [work_order_list](work_order_list.md), [farming](farming.md) (seed stock).
