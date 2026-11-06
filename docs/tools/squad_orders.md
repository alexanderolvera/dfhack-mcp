---
tool: squad_orders
tier: actuator
gated: actuator
source: src/tools/squadOrders.ts
lua: src/dfhack-queries/mcp_squad_orders.lua
tags: [dfhack-mcp/tool]
---

# squad_orders

> Order a military squad to move to a tile, kill named units, or cancel its orders.

## Purpose
The emergency loop's final actuator. `burrows`/`civilian_alert` move *civilians* out of danger and `mechanisms`/`pull_lever` closes the fort; this commands the *military*. Execute-never-decide: the caller names the squad (`squad_id` from `military()`), the order, and its exact target — the tool never chooses a target, a squad, or a moment to fight.

This is the highest-stakes actuator in the server. It sends real dwarves into real combat, and dwarves who die carrying out the order stay dead — no undo reaches them. The reversal (`cancel`) releases a squad from its orders; it does not walk anyone back or un-fight a fight.

## Parameters
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| squad_id | number (int) | Yes | — | Squad id from `military().squads[].squad_id`. |
| order | `"move"` \| `"kill"` \| `"cancel"` | Yes | — | `move` = go to x,y,z and hold; `kill` = attack `target_unit_ids`; `cancel` = clear this squad's orders and release it. |
| x, y, z | number (int) | For `move` | — | Move target tile. |
| target_unit_ids | number[] (int) | For `kill` | — | Unit ids to kill (e.g. from `threats()`), max 32. |
| confirm_token | string | No | — | Omit to DRY-RUN; pass the returned token to APPLY. |

## Returns
Two-call protocol (shared actuator envelope from `src/actuator.ts`).

**Dry-run**: `{ mode: "preview", applied: false, preview, confirm_token }` — or `blocked: [...]` with NO token.
- `squad_id`, `squad_name`, `order`
- `member_count` — living, present members: the dwarves who would actually go. A squad whose positions are all filled by dead or off-map holders reads 0 here and is blocked.
- `current_orders[]` — what the squad is doing right now: `{ type, reported_as_complete, pos? (MOVE), target_unit_ids?/title? (KILL_LIST) }`.
- `move`: `target` (`{x,y,z}`), `target_undiscovered` (a reported fact, not a block), `replaces_existing_orders`.
- `kill`: `targets[]` — `{ unit_id, name, pos, great_danger }` per resolved target — plus `replaces_existing_orders`.
- `cancel`: `orders_that_would_be_cancelled`. A cancel with nothing to clear previews as `would_be_noop`.

**Apply**: `{ mode: "apply", applied: true, changes, undo, readback }` — `changes` carries the squad, order, `cleared_previous_orders`, and the target/targets; `undo` is the documented reversal with its `faithful` flag; `readback` re-reads the squad's `orders[]` and `member_count` after the write.

No golden fixture exists for this tool (actuators are not golden-tested — their previews mint a fresh random token).

## Caveats & limits
- Gated: registered only when `DFHACK_MCP_ACTUATORS` is set.
- **Orders replace, they do not stack.** DF treats `squad.orders` as the squad's whole standing instruction set, so an apply first clears whatever that squad was already doing. `replaces_existing_orders` (preview) and `cleared_previous_orders` (apply) report how many. A cleared order is NOT restored by a later `cancel`, which is why `undo.faithful` is false whenever anything was cleared.
- **Blocked with no token** (nothing partially applies): unknown `squad_id`, or a squad belonging to another entity (a visiting lord's retinue is not yours to command, and `military()` never lists it); a squad with no living present members; a move target off-map or on a non-walkable tile; a kill target that is dead/off-map, one of your own citizens, or standing on an **undiscovered tile**; more than 32 kill targets; an empty kill list.
- **Fog-of-war gate on kill targets.** A unit on an undiscovered tile cannot be targeted — ordering an attack on it would act on knowledge the fort does not have. This is the same fail-closed doctrine the unit-listing sensors follow (`mcp_unitVisibility`), applied to a *write*: verified live against a fixture whose only four hostiles were all on undiscovered tiles, every one correctly refused.
- `target_undiscovered` on a **move** is reported as a fact and does NOT block — designating movement into unexplored space is a legitimate order (the same posture `blueprint_apply` takes with `fog_of_war_tiles`), whereas naming a specific unseen creature as a target is not.
- **DF removes a completed KILL order itself.** Once the targets are dead the order simply disappears from `current_orders` rather than lingering — verified live (target died, `#squad.orders` went 1 → 0 with no intervention). Do not read an empty order list as "the order never took".
- Token is single-use and void if the squad's own order list or living-member set changes between preview and apply (verified live by injecting an order behind the tool's back — the token was correctly refused).
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Implementation notes
- Orders are `df.squad_order_movest` (`pos` coord, `point_id = -1`) and `df.squad_order_kill_listst` (`units` / `histfigs`, both `vector<int32_t>`, plus a display `title`), inserted into `squad.orders`. Verified live that inserting into that vector genuinely drives the squad: four members of the target squad began pathing to the ordered tile within ~2000 frames, and erasing + `:delete()`-ing the order released them (`path.goal` back to `-1`).
- `histfigs` only receives real historical-figure ids. Not every creature has one — the fixture's own hostiles reported `hist_figure_id == -1` — so inserting it unconditionally would push `-1` into the list.
- The apply clears existing orders with a reverse-index loop (`for i = #orders-1, 0, -1`) and `:delete()`s each removed order, since erasing forward would skip entries and dropping the pointer without deleting would leak the order object.
- `signature` covers only this squad's own order list (type + target + completion flag) and its living-member id set — deliberately not the whole fort, so an unrelated change elsewhere doesn't needlessly void a token, per the `PlanResult.signature` contract in `actuator.ts`.
- Squad ownership is checked against `df.global.plotinfo.main.fortress_entity`, matching `military()`'s own filter, so the two tools can never disagree about which squads exist.
- Confirmed live on DFHack 53.15-r2 against the Dreamfort fixture container: full preview→apply→readback for `move`, `kill` and `cancel`; all blocked cases; and the token-drift refusal.

## Related
- [military](military.md) — the paired sensor; source of `squad_id` and squad readiness.
- [threats](threats.md) — source of hostile `unit_id`s for a kill order.
- [burrows](burrows.md) / [civilian_alert](civilian_alert.md) — the civilian half of the emergency loop.
- [mechanisms](mechanisms.md) / [pull_lever](pull_lever.md) — sealing the fort.
