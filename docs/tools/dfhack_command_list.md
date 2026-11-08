---
tool: dfhack_command_list
tier: reference
gated: none
source: src/tools/dfhackCommand.ts
tags: [dfhack-mcp/tool]
---

# dfhack_command_list

> Every command DFHack itself ships, with its one-line help and tags, from DFHack's own `ls`.

## Purpose
Reports what DFHack can do beyond this server's curated tools: built-in commands, plugins, and scripts, as DFHack's `ls [tag|search]` lists them, plus the tag set from `tags`. Facts only: it reports which commands exist and what DFHack's own help says they do, never what to run. Running a command is [dfhack_command_run](dfhack_command_run.md), which accepts only a small allowlist; this tool deliberately lists the full surface. Always available (no gate), and works with no fort loaded.

## Parameters
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `filter` | string | no | none (every command) | a tag (see `tags` in the result) or a command-name substring, passed to `ls`; must be one word and must not start with `-` |

## Returns
| Field | Meaning |
|---|---|
| `filter` | the filter given, or `null` |
| `filter_kind` | `"tag"` when `filter` names a tag from `tags[]` (so `ls` lists that tag's commands), `"search"` for a name substring, `null` with no filter |
| `count` | number of entries in `commands[]` |
| `commands[]` | one per command, in DFHack's order (built-ins, then plugins, then scripts) |
| `commands[].name` | the command as typed in the DFHack console, e.g. `seedwatch`, `gui/seedwatch` |
| `commands[].help` | DFHack's one-line help, joined from its wrapped console lines |
| `commands[].tags` | the command's tags |
| `tags[]` | every tag DFHack defines: `{tag, description}` |

Example (`filter: "seed"`, fixture fort, `tags[]` trimmed):

```json
{
  "filter": "seed",
  "filter_kind": "search",
  "count": 2,
  "commands": [
    { "name": "gui/seedwatch", "help": "Manages seed and plant cooking based on seed stock levels.", "tags": ["auto", "fort", "plants"] },
    { "name": "seedwatch", "help": "Automatically toggle seed cooking based on quantity available.", "tags": ["auto", "fort", "plants"] }
  ],
  "tags": [
    { "tag": "adventure", "description": "Tools that are useful while in adventure mode." },
    { "tag": "workorders", "description": "Tools that interact with workorders." }
  ]
}
```

## Caveats & limits
- Unfiltered, the list is large: 311 commands on DFHack 53.15-r2.
- Developer and modder commands (`ls --dev`) are not listed, and no `ls` option is exposed.
- DFHack's own `ls` output is the source; text is reported as DFHack prints it.

## Implementation notes
- `ls` and `tags` are DFHack built-ins, reached through the same `RunCommand` RPC the `mcp_*.lua` scripts use (`runDfhackCommand` in `src/dfclient.ts`). Their console TEXT frames are captured as plain text.
- `ls` lays out each entry as the name in a 21-column field followed by the help, wrapped onto lines indented 22 spaces, then an indented `tags:` line that can itself wrap. A name longer than the field gets a line of its own. `parseLs` reads that layout.
- On DFHack 53.15-r2, `ls` and `tags` sometimes print `Failed Lua call to helpdb.<fn> (could not acquire core lock).` and still return `CR_OK`. In live runs this mostly happened on a call that came right after another helpdb call. Both commands are read-only, so the tool retries each one up to 3 times and otherwise returns `{"error":"command failed","command_result":"CR_OK","output":...}`.

## Related
[dfhack_command_run](dfhack_command_run.md) (run an allowlisted command), [run_lua](run_lua.md) (dev-only raw Lua).
