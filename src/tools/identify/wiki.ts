import { type CreatureDossier } from '../gameData.ts';

/** A trimmed slice of wiki strategy context, tagged with why it was fetched. */
export interface WikiExcerpt {
  topic: string;
  title: string;
  url: string;
  excerpt: string;
}

const WIKI_EXCERPT_CHARS = 700;

const FIRE_INTERACTION = /fire|flame|magma|jet|fireball/i;

function isFireCreature(d: CreatureDossier): boolean {
  return (
    d.flags.some((f) => f.startsWith('FIREIMMUNE')) ||
    (d.interactions ?? []).some((i) => FIRE_INTERACTION.test(i.name))
  );
}

/**
 * Trims cleaned wiki text to a short excerpt on a word boundary.
 * @param text Cleaned wiki article text.
 * @param max Maximum excerpt length in characters.
 * @returns The trimmed excerpt, ellipsized if cut short.
 */
export function excerpt(text: string, max = WIKI_EXCERPT_CHARS): string {
  const clean = (text ?? '').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + ' …';
}

/**
 * Reports whether a creature is procedural (demon, forgotten beast, titan) and so has no wiki page.
 * @param d Creature dossier to check.
 * @returns True if the creature has no dedicated wiki page.
 */
export function isProcedural(d: CreatureDossier): boolean {
  if (d.flags.includes('DEMON')) return true;
  return /FORGOTTEN|TITAN/i.test(d.token) || /forgotten beast|titan/i.test(d.name);
}

/**
 * Picks at most ~2 wiki pages worth fetching for a creature: its own page (unless procedural)
 * plus the single most relevant trait page.
 * @param d Creature dossier to plan lookups for.
 * @returns Up to two `{topic, title}` wiki lookup targets.
 */
export function wikiPlan(d: CreatureDossier): { topic: string; title: string }[] {
  const plan: { topic: string; title: string }[] = [];
  if (!isProcedural(d)) plan.push({ topic: `creature: ${d.name}`, title: d.name });
  if (isFireCreature(d)) plan.push({ topic: 'fire', title: 'Fire' });
  else if (d.flags.includes('BUILDINGDESTROYER'))
    plan.push({ topic: 'building destroyer', title: 'Building destroyer' });
  return plan.slice(0, 2);
}
