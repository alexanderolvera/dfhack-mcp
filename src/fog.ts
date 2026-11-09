import { z } from 'zod';

export type FogOfWar = 'applied' | 'bypassed';

export interface FogReport {
  fog_of_war: FogOfWar;
}

/** The `reveal_hidden` input every fog-gated tool shares. */
export const revealHiddenParam = z
  .boolean()
  .optional()
  .describe(
    'Bypass fog of war: also report what stands on undiscovered tiles and in undiscovered ' +
      'caverns. Default false. The response reports the mode it ran in as fog_of_war.'
  );

/** The sentence every fog-gated tool's description ends its fog-of-war note with. */
export const FOG_OF_WAR_NOTE =
  'Fog of war is applied by default; pass reveal_hidden=true to bypass it. Every response ' +
  'reports fog_of_war: "applied" | "bypassed".';

/**
 * Builds the argv suffix that asks a query script's shared fog gate to bypass fog of war.
 * @param revealHidden The tool's `reveal_hidden` input.
 * @returns `['--reveal-hidden']` when bypassing, otherwise `[]`.
 */
export function fogArgs(revealHidden?: boolean): string[] {
  return revealHidden ? ['--reveal-hidden'] : [];
}
