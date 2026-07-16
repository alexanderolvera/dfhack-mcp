// identify: tactics derivation. Turns a creature dossier's flags/interactions
// into the decisive tactical traits, each paired with its HARD game-fact
// implication (facts, not strategy opinions — mirrors unmet_needs' need→suggestion).
// The motivating failure this prevents: advising cage traps on a TRAPAVOID demon
// because only the general "Fire" wiki page was read.

import { type CreatureDossier } from '../gameData.ts';

/** A decisive trait present on the creature, paired with its game-fact implication. */
export interface Tactic {
  trait: string;
  note: string;
}

// Interaction names that signal a fire breath weapon even without a FIREIMMUNE flag.
const FIRE_INTERACTION = /fire|flame|magma|jet|fireball/i;

/** Derive the decisive tactical traits from a dossier's flags/interactions,
 *  each with a factual implication. Only present traits are included. */
export function deriveTactics(d: CreatureDossier): Tactic[] {
  const flags = new Set(d.flags);
  const interactions = d.interactions ?? [];
  const tactics: Tactic[] = [];

  if (flags.has('TRAPAVOID')) {
    tactics.push({
      trait: 'trapavoid',
      note: 'Mechanical traps (cage, weapon, stonefall) do not work on it.',
    });
  }
  if (flags.has('FLIER')) {
    tactics.push({
      trait: 'flier',
      note: 'Flies over walls and moats; containment needs a roof, not just a bridge.',
    });
  }
  const fireFlag = d.flags.some((f) => f.startsWith('FIREIMMUNE'));
  const fireInteraction = interactions.some((i) => FIRE_INTERACTION.test(i.name));
  if (fireFlag || fireInteraction) {
    tactics.push({
      trait: 'fire',
      note: 'Immune to fire/magma and spreads fire; cannot be burned, and ignites dwarves/items nearby.',
    });
  }
  if (flags.has('BUILDINGDESTROYER')) {
    tactics.push({
      trait: 'building_destroyer',
      note: "Smashes doors, bridges, and buildings; most static defenses won't hold.",
    });
  }
  if (flags.has('WEBBER')) {
    tactics.push({
      trait: 'webber',
      note: 'Shoots webs that immobilize; approach with care.',
    });
  }
  if (interactions.length > 0) {
    tactics.push({
      trait: 'ranged',
      note: `Ranged attacks: ${interactions.map((i) => i.name).join(', ')}.`,
    });
  }
  return tactics;
}
