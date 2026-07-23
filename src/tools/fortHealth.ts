import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface FortHealth {
  fps: number;
  gfps: number;
  items: {
    total: number;
    stone: number;
    corpses: number;
    clothes: number;
  };
  units: {
    active: number;
    dead_on_map: number;
  };
}

export function fortHealth(): Promise<FortHealth | { error: string }> {
  return runJsonScript<FortHealth>('fortHealth', []);
}

export const fortHealthDef: ToolDef = {
  name: 'fort_health',
  title: 'Fort health',
  description:
    "The fort's computational health as facts — FPS death is the true endgame " +
    'boss, and nothing else reports it. fps/gfps are the engine\'s own currently ' +
    'calculated simulation/graphics frame rates (df.global.enabler.calculated_fps' +
    '/calculated_gfps — the same numbers DF\'s own FPS counter shows), not an ' +
    "average or a history. items.total is the fort-wide item-object count " +
    "(df.global.world.items.all, unfiltered by forbidden/dump/rotten/construction " +
    'state — every item DF is tracking counts toward this, since object count, not ' +
    "usable stock, is what costs simulation time); items.stone/corpses/clothes " +
    'break out the three clutter candidates the issue names (stone: BOULDER; ' +
    'corpses: CORPSE + CORPSEPIECE + REMAINS; clothes: the wearable slots ARMOR/' +
    'SHOES/HELM/GLOVES/PANTS) — these are raw totals and will run higher than ' +
    "stocks' counts, which filter to usable/in-play items only; the two answer " +
    'different questions (clutter vs usable stock) and are not duplicates. ' +
    'units.active/units.dead_on_map split df.global.world.units.active by ' +
    'isDead — active is every currently-simulated living unit (citizens, tame ' +
    'animals, wildlife, hostiles, visitors), dead_on_map is a dead unit whose ' +
    "body hasn't yet been cleaned up into a corpse item; both are unfiltered by " +
    'fog-of-war, deliberately, since an undiscovered cavern\'s unrevealed units ' +
    'still cost simulation time — this tool reports computational load, not ' +
    "what the fort has discovered. Stray/unassigned animal count is intentionally " +
    "NOT duplicated here: call livestock_and_pastures and read its " +
    'unassigned_count. Returns {"error":"no fort loaded"} if no fort is active.',
  run: fortHealth,
};
