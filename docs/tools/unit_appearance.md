---
tool: unit_appearance
tier: sensor
gated: none
source: src/tools/unitAppearance.ts
lua: src/dfhack-queries/mcp_unitAppearance.lua
tags: [dfhack-mcp/tool]
---

# unit_appearance

> What ONE unit looks like: the portrait read, chained by unit_id from find_unit.

## Purpose
Gives an image or narrative client what it needs to draw or describe one unit: DF's own appearance modifiers (eye set, nose shape, hair length, voice, height, broadness, ...), how hair, beard, moustache, and sideburns are styled, hair/skin/eye colors as DF's descriptors name them, permanent marks (missing parts, scars), and the current kit, meaning everything worn, wielded, and carried, with material, quality, wear, dye, and decorations. `citizen` covers who a dwarf is; this tool covers what they look like.

## Parameters
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| unit_id | integer (coerced, ≥ 0) | Yes | — | A live unit_id, e.g. from a find_unit match. |
| reveal_hidden | boolean | No | `false` | Bypass [fog of war](../../CONTRIBUTING.md#fog-of-war-the-reveal_hidden-opt-in): also read what stands on undiscovered tiles. The response reports the mode as `fog_of_war`. |

## Returns
- `unit_id`, `name`, `race` (creature name, e.g. `dwarf`), `caste` (caste token, e.g. `MALE`), `sex`, `age` (whole years), `body_size_cm3` (current body size).
- `features[]`: `{ feature, layer?, modifier, value, desc_band, parts?, parts_truncated? }`. One row per distinct appearance modifier.
  - `feature` is the modifier's DF noun (`eyes`, `ears`, `teeth`, `hair`, `skin`, ...), or the body-part name when the raws give no noun (`nose`, `skull`, `head`). The whole-body modifiers (`HEIGHT`, `BROADNESS`, and for some creatures `LENGTH`) use `feature: "body"` and have no `parts`.
  - `layer` is the tissue layer token when the modifier sits on a layer (`HAIR`, `MOUSTACHE`, `CHIN_WHISKERS`, `EYEBROW`, `SKIN`, ...).
  - `modifier` is DF's `appearance_modifier_type` token (`LENGTH`, `CLOSE_SET`, `DEEP_SET`, `LARGE_IRIS`, `HIGH_CHEEKBONES`, `GREASY`, `WRINKLY`, ...).
  - `value` is the raw modifier value (100 is typical for most).
  - `desc_band` (-3..3) places `value` within the caste's six `APP_MOD_DESC_RANGE` thresholds. 0 is the middle band, which DF's own description leaves undescribed. Negative bands are below the typical value and positive bands above it, in the direction the modifier token names (`LENGTH` +2 is longer than typical).
  - `parts` lists the body parts that share this exact value, sorted and capped at 6 (`parts_truncated: true` past that). Skin `WRINKLY` spans dozens of parts.
- `tissue_styles[]`: `{ tissue, style, layers[] }`. `tissue` is the caste's style noun (`hair`, `beard`, `moustache`, `sideburns`), `style` is DF's `tissue_style_type` token (`NEATLY_COMBED`, `PONY_TAIL`, `CLEAN_SHAVEN`, `BRAIDED`, ...), and `layers[]` lists the tissue layers it applies to. Layers DF leaves unstyled (`NONE`, e.g. eyebrows) are omitted. Length lives in `features[]` as that layer's `LENGTH` modifier.
- `colors[]`: `{ part, pattern, pattern_type, colors[], since_age?, full_at_age? }`. `part` is the color modifier's part noun (`hair`, `skin`, `eyes`, ...), `pattern` is the `descriptors.patterns` token (`GOLDEN_YELLOW`, `IRIS_EYE_AMETHYST`), `pattern_type` is `MONOTONE`/`STRIPES`/`IRIS_EYE`/`SPOTS`/..., and `colors[]` are the pattern's descriptor color names in pattern order (an `IRIS_EYE` lists sclera, pupil, iris). Age-timed replacements (hair `GRAY`, `WHITE`) appear only once the unit has reached `since_age`, and are fully in effect at `full_at_age`; a base color and a replacement in progress can both be present.
- `missing_parts[]`: names of the top-most missing body parts (a part whose parent is also missing is implied and not listed). Capped at 20 with `missing_parts_truncated`.
- `scars[]`: `{ part, layer?, kinds[] }`, one row per scarred part/layer. `kinds` are the `scar_*` wound-part flags DF sets on healing (`scar_cut`, `scar_smashed`, `scar_broken`, `scar_edged_shake1`, `scar_blunt_shake1`, `scar_joint_bend1`, ...). Capped at 20 with `scars_truncated`.
- `inventory[]`: `{ item_id, role, body_part?, item, type, material?, quality, wear?, dye?, decorations[], artifact_name? }`. `role` is DF's `inv_item_role_type` (`Worn`, `Weapon`, `Flask`, `Hauled`, `Strapped`, `StuckIn`, `Piercing`, `WrappedAround`, `InMouth`, `Pet`, `SewnInto`), `body_part` is where it is held or worn, `item` is DF's plain description, `type` is the `item_type` token, and `quality` is the `item_quality` name (`Ordinary` … `Masterful`, `Artifact`). `wear` (1 worn, 2 threadbare, 3 tattered) is omitted when 0. `dye` is `{ material, color }` for dyed cloth. `decorations[]` is `{ type, material, quality }` per improvement (`ART_IMAGE`, `COVERED`, `RINGS_HANGING`, `BANDS`, `SPIKES`, `SEWN_IMAGE`, ...). Sorted by role, body part, then item id, and capped at 30 with `inventory_truncated`.
- `fog_of_war` — `"applied"` (the default) or `"bypassed"` (with `reveal_hidden=true`).

```json
{
  "age": 57,
  "body_size_cm3": 6950,
  "caste": "MALE",
  "colors": [
    { "colors": ["white", "black", "amethyst"], "part": "eyes", "pattern": "IRIS_EYE_AMETHYST", "pattern_type": "IRIS_EYE" },
    { "colors": ["golden yellow"], "part": "hair", "pattern": "GOLDEN_YELLOW", "pattern_type": "MONOTONE" },
    { "colors": ["ecru"], "part": "skin", "pattern": "ECRU", "pattern_type": "MONOTONE" }
  ],
  "features": [
    { "desc_band": 0, "feature": "body", "modifier": "BROADNESS", "value": 98 },
    { "desc_band": 2, "feature": "eyes", "modifier": "DEEP_SET", "parts": ["left eye", "right eye"], "value": 154 },
    { "desc_band": 1, "feature": "hair", "layer": "HAIR", "modifier": "LENGTH", "parts": ["head"], "value": 182 },
    { "desc_band": 2, "feature": "teeth", "modifier": "GAPS", "parts": ["lower front tooth", "..."], "value": 186 }
  ],
  "inventory": [
    { "body_part": "right hand", "decorations": [], "item": "steel battle axe", "item_id": 22682, "material": "steel", "quality": "Exceptional", "role": "Weapon", "type": "WEAPON" },
    { "body_part": "upper body", "decorations": [], "dye": { "color": "midnight blue", "material": "dimple dye" }, "item": "cave spider silk shirt", "item_id": 7809, "material": "cave spider silk", "quality": "Ordinary", "role": "Worn", "type": "ARMOR" }
  ],
  "missing_parts": [],
  "name": "Tun Lolumavuz \"Woodenmines\", militia commander",
  "race": "dwarf",
  "scars": [],
  "sex": "male",
  "tissue_styles": [
    { "layers": ["CHEEK_WHISKERS", "CHIN_WHISKERS"], "style": "NEATLY_COMBED", "tissue": "beard" },
    { "layers": ["HAIR"], "style": "PONY_TAIL", "tissue": "hair" }
  ],
  "unit_id": 111
}
```

## Caveats & limits
- Returns `{"error":"no visible unit with id N ..."}` both for an id that doesn't exist and for a unit standing on an undiscovered tile (fog of war, via `mcp_unitVisibility`). The two cases share one message so the error never confirms that an unseen unit exists. Off-map units fail closed the same way.
- **Fog-of-war bypass**: with `reveal_hidden=true`, a unit standing on an undiscovered tile resolves instead of returning the not-found error.
- Returns `{"error":"no fort loaded"}` when no fort is active.
- Works for any unit, not just citizens: animals return their own caste's modifiers and colors (a dog has a `body` `LENGTH` and a `tail` color), usually with empty `tissue_styles` and `inventory`.
- Item contents aren't walked: a backpack or quiver is listed, but not what's inside it.
- The Dreamfort fixture has no scarred and no partially dismembered citizens, so `scars[]` and the partial-loss shape of `missing_parts[]` are verified for field paths only (the `scar_*` flag names and `body_part_status[].missing` were confirmed live), not against a populated example.

## Design decisions (issue #102, Phase 1)
- **Structured modifier facts, not reconstructed DF prose.** DF's description sentences ("His hair is tied in a pony tail. His very long moustache is neatly combed.") are built from adjective tables hardcoded in the executable, not stored in the raws. The raws hold only the modifier type, its thresholds, and a noun. Reconstructing the prose would mean keeping a hand-maintained word table per modifier type and band (the work Dwarf Therapist does), which is a second source of truth that drifts with each DF version. Instead the tool emits DF's own tokens, the raw value, and `desc_band`, the one derived number needed to read a value the way DF does. A client that wants prose can map `(modifier, desc_band)` to words itself.
- **A separate tool, not an expansion of `citizen.physical`.** `citizen` is already a large payload and most of its callers don't want a portrait. This read is about 8 KB per dwarf on its own and applies to any unit, animals included, not just citizens.

## Implementation notes
Confirmed live on DF 53.15 / DFHack 53.15-r2 (the `df-headless:53.15` fixture):

- **Appearance arrays index into the caste raws by position.** `u.appearance.body_modifiers[i]` pairs with `caste.body_appearance_modifiers[i].modifier`. `u.appearance.bp_modifiers[i]` pairs with `caste.bp_appearance.modifiers[caste.bp_appearance.modifier_idx[i]].modifier`, on body part `caste.bp_appearance.part_idx[i]` and layer `caste.bp_appearance.layer_idx[i]` (-1 means the modifier is on the part itself). A dwarf has 2 body modifiers and 130 bp modifiers, which collapse to about 50 rows once rows with the same feature, layer, modifier, and value are merged (left/right pairs, all six teeth, every skin patch).
- **Body parts live at `caste.body_info.body_parts`**, not `caste.body` (which raises `Cannot read field caste_raw.body`). A part's display name is `name_singular[0].value`, and its layer name is `layers[layer_idx].layer_name`.
- **`appearance_modifierst`** carries `type` (`df.appearance_modifier_type`), `ranges[7]`, `desc_range[6]`, and `noun`. `desc_band` counts the thresholds `value >= desc_range[k]`, minus 3, so it runs from -3 to 3. Whether DF treats a value exactly on a threshold as being in the upper band has not been checked against DF's rendered prose, so boundary values may be off by one band from what the game prints.
- **Tissue styles**: `u.appearance.tissue_style[i]` is the `df.tissue_style_type`, `tissue_style_type[i]` is the raw style's `id` (matched against `caste.tissue_styles[].id` for its `noun`), and the styled layer is `bp_appearance.style_part_idx[i]` / `style_layer_idx[i]`. `tissue_length[i]` equals the same layer's `LENGTH` bp modifier value on every row observed, so it isn't emitted twice. Rows with style `NONE` (eyebrows, eyelashes) have length -30000 and are skipped.
- **Colors**: `u.appearance.colors[i]` is an index into `caste.color_modifiers[i].pattern_index`, which gives a `descriptors.patterns` entry whose `colors[]` index `descriptors.colors` (`.name` is the English name). `color_modifier_raw.start_date`/`end_date` are in days (336 per year): dwarf hair `GRAY` is 26880→43680 (80→130 years) and `WHITE` is 43680→50400 (130→150). A row with `start_date` 0 is the untimed base color. The unit's age in days is `dfhack.units.getAge(u, true) * 336`.
- **Missing parts**: the issue's `body_part_status[].gone` doesn't exist on this build. The flag is `body_part_status[i].missing`. Only parts whose `con_part_id` parent isn't also missing are listed, so a fully butchered corpse reads `["upper body"]`.
- **Scars**: `u.body.wounds[].parts[].flags1` carries `scar_cut`, `scar_smashed`, `scar_edged_shake1`, `scar_broken`, `scar_blunt_shake1`, and `scar_joint_bend1`. They are scanned dynamically by prefix, the same way `injuries_and_health` excludes them. `pt.layer_idx` indexes the part's `layers`.
- **Inventory**: on the fixture, citizens' `u.inventory[].mode` values are `Worn` (699), `Weapon` (29, shields included), `Flask` (13), and `Hauled` (7). All roles are emitted, not just `mcp_military`'s worn set. Every constructed clothing item carries a `THREAD` and a `CLOTH` improvement for the cloth it was sewn from. Those two are structural, not decorations, so they are left out of `decorations[]`. The dye lives on the `THREAD` improvement's `dye.mat_type`/`dye.mat_index` (-1 means undyed), and its color is that material's `state_color.Solid` descriptor color. `improvements` exists only on `df.item_constructed` instances (seeds and similar raise `Cannot read field item_seedsst.improvements`).

## Related
[citizen](citizen.md) · [find_unit](find_unit.md) · [injuries_and_health](injuries_and_health.md) · [military](military.md)
