# DFHack Lua type stubs (dev-only)

EmmyLua / [lua-language-server](https://github.com/LuaLS/lua-language-server)
type definitions that give the query layer (`src/dfhack-queries/mcp_*.lua`)
autocomplete and go-to-definition on the version-fragile field paths —
`df.global.world.raws.creatures.all`, `dfhack.units.*`, caste paths, etc.

## DFHack version these match

**53.15-r2** (`DF_VERSION 53.15`, `DFHACK_RELEASE r2`). The `df.*` layout is
build-specific — these stubs are only correct for this tag. On a DF/DFHack bump,
re-derive them (see "Provenance" below) and update this line.

## Files

| File          | Covers                                    | Source of truth (53.15-r2)                                             |
| ------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| `df.lua`      | the generated `df` global + df-structures records/enums | `library/xml/df.*.xml` (`creature_raw` @ df.creature.xml:1485)          |
| `dfhack.lua`  | `dfhack.units` / `.maps` / `.translation` C++ module functions | `docs/dev/Lua API.rst` (line refs inline in the stub)                   |
| `builtins.lua`| `reqscript`, `require('json')`, `printall` | `library/lua/dfhack.lua` (reqscript @ 1031), `library/lua/json.lua`     |

## Provenance — why these are hand-authored, not vendored verbatim

DFHack 53.15-r2 ships EmmyLua annotations for its **pure-Lua** library modules
(gui widgets, `utils`, `argparse`, the `dfhack` core class) but **not** for the
two surfaces this project's queries actually depend on:

- **`df.*`** (df-structures) is materialised at runtime from the XML — there is
  no static `.lua` file to copy.
- **`dfhack.units.*`, `dfhack.maps.*`, `dfhack.translation.*`** are C++ bindings;
  `library/lua/dfhack/` contains only `buildings.lua` + `workshops.lua`.

So these stubs are a **curated subset** transcribed as FACTS from the pinned
df-structures XML and `Lua API.rst` — only the fields/functions the `mcp_*.lua`
scripts touch. Unlisted members won't autocomplete; that's intentional (keeps
the stub auditable and honest rather than a fabricated full type set).

To refresh against a local DFHack clone at the matching tag:

```sh
# creature_raw / caste_raw field names + types:
grep -n "type-name='creature_raw'" library/xml/df.creature.xml
# dfhack module signatures:
grep -n "dfhack.units.getCitizens" "docs/dev/Lua API.rst"
```

## How the wiring works (`../.luarc.json`)

`.luarc.json` at the repo root points lua-language-server here:

- `workspace.library: [".dfhack-stubs"]` — LLS loads every `.lua` in this dir as
  a type-definition library, so the `---@class df` / `---@class dfhack` metas
  apply to the whole workspace.
- `diagnostics.globals: ["df","dfhack","reqscript",...]` — declares the
  DFHack-injected globals so they aren't flagged as undefined.
- `runtime.version: "Lua 5.3"` — DFHack embeds Lua 5.3.

Resolution chain for the acceptance path `df.global.world.raws.creatures.all`:

```
df                -> ---@class df           .global
  .global         -> df.global_type         .world
  .world          -> df.world               .raws
  .raws           -> df.world_raws          .creatures
  .creatures      -> df.world_raws.T_creatures  .all
  .all            -> df.creature_raw[]       (element: creature_id, name,
                                              adultsize, caste, flags)
```

Each hop is a `---@field` in `df.lua`, so typing a `.` at any level shows the
next set of members, and go-to-definition jumps to the stub line — which cites
its df-structures XML origin.

## This directory is dev-only

- Excluded from the `tsup` build (`tsup.config.ts` bundles `src/index.ts` and
  copies `src/dfhack-queries/*.lua` only) — nothing here reaches `dist/`.
- Excluded from `tsc` (`tsconfig.json` `include` is `src/**/*.ts`) and from
  ESLint (`eslint.config.js` globs `src/**` + `scripts/**`).
- No runtime code imports it. It exists purely for the editor.
