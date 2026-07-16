// identify: wiki-topic selection + excerpting. Decides WHICH (at most ~2) wiki
// pages are worth fetching for a creature and trims their cleaned text to a short
// excerpt, so identify never dumps a whole article.

import { type CreatureDossier } from '../gameData.ts';

/** A trimmed slice of wiki strategy context, tagged with why it was fetched. */
export interface WikiExcerpt {
  topic: string;
  title: string;
  url: string;
  excerpt: string;
}

const WIKI_EXCERPT_CHARS = 700;

/** Trim cleaned wiki text to a short excerpt on a word boundary (never dump the page). */
export function excerpt(text: string, max = WIKI_EXCERPT_CHARS): string {
  const clean = (text ?? '').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + ' …';
}

/** Procedural creatures (demons, forgotten beasts, titans) have no wiki page —
 *  we skip the per-creature lookup for them and lean on the raws + trait pages. */
export function isProcedural(d: CreatureDossier): boolean {
  if (d.flags.includes('DEMON')) return true;
  return /FORGOTTEN|TITAN/i.test(d.token) || /forgotten beast|titan/i.test(d.name);
}

/** Pick at most ~2 wiki pages: the creature's own page (unless procedural) plus
 *  the single most relevant trait page (fire beats building_destroyer). */
export function wikiPlan(
  d: CreatureDossier,
  traits: Set<string>
): { topic: string; title: string }[] {
  const plan: { topic: string; title: string }[] = [];
  if (!isProcedural(d)) plan.push({ topic: `creature: ${d.name}`, title: d.name });
  if (traits.has('fire')) plan.push({ topic: 'fire', title: 'Fire' });
  else if (traits.has('building_destroyer'))
    plan.push({ topic: 'building destroyer', title: 'Building destroyer' });
  return plan.slice(0, 2);
}
