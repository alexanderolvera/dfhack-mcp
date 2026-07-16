// identify(query): "what is this creature and how do I handle it" as ONE call.
// Fuses THIS WORLD's raws (ground truth) with the DF wiki (strategy). It does not
// re-read raws or re-implement wiki fetching — it COMPOSES game_data (resolution +
// dossier) and wiki_lookup (cleaned article text), then derives the decisive
// tactical traits so a caller can't miss them (the motivating failure: advising
// cage traps on a TRAPAVOID demon because only the general "Fire" page was read).

import { gameData, type CreatureDossier, type GameDataStub } from './gameData.ts';
import { wikiLookupTool } from './wikiLookup.ts';

/** A decisive trait present on the creature, paired with its hard game-fact
 *  implication (facts, not strategy opinions — mirrors unmet_needs' need→suggestion). */
export interface Tactic {
  trait: string;
  note: string;
}

/** A trimmed slice of wiki strategy context, tagged with why it was fetched. */
export interface WikiExcerpt {
  topic: string;
  title: string;
  url: string;
  excerpt: string;
}

/** The fused answer for a single strong creature match. */
export interface Identify {
  query: string;
  creature: CreatureDossier;
  tactics: Tactic[];
  wiki: WikiExcerpt[];
  notes?: string[];
}

/** Passthrough when game_data can't narrow to one creature — let the caller pick. */
export interface IdentifyDisambiguation {
  query: string;
  match_count: number;
  truncated?: boolean;
  matches: GameDataStub[];
}

const WIKI_EXCERPT_CHARS = 700;
// Interaction names that signal a fire breath weapon even without a FIREIMMUNE flag.
const FIRE_INTERACTION = /fire|flame|magma|jet|fireball/i;

/** Trim cleaned wiki text to a short excerpt on a word boundary (never dump the page). */
function excerpt(text: string, max = WIKI_EXCERPT_CHARS): string {
  const clean = (text ?? '').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + ' …';
}

/** Procedural creatures (demons, forgotten beasts, titans) have no wiki page —
 *  we skip the per-creature lookup for them and lean on the raws + trait pages. */
function isProcedural(d: CreatureDossier): boolean {
  if (d.flags.includes('DEMON')) return true;
  return /FORGOTTEN|TITAN/i.test(d.token) || /forgotten beast|titan/i.test(d.name);
}

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

/** Pick at most ~2 wiki pages: the creature's own page (unless procedural) plus
 *  the single most relevant trait page (fire beats building_destroyer). */
function wikiPlan(d: CreatureDossier, traits: Set<string>): { topic: string; title: string }[] {
  const plan: { topic: string; title: string }[] = [];
  if (!isProcedural(d)) plan.push({ topic: `creature: ${d.name}`, title: d.name });
  if (traits.has('fire')) plan.push({ topic: 'fire', title: 'Fire' });
  else if (traits.has('building_destroyer'))
    plan.push({ topic: 'building destroyer', title: 'Building destroyer' });
  return plan.slice(0, 2);
}

export async function identify(
  query: string
): Promise<Identify | IdentifyDisambiguation | { error: string }> {
  // Step 1 — delegate resolution (token / name / live unit_id) to game_data.
  const data = await gameData(query);
  if ('error' in data) return data; // {error} passthrough (e.g. no game loaded, no match)
  if ('match_count' in data) {
    // Disambiguation list — pass it through so the caller can narrow.
    return {
      query,
      match_count: data.match_count,
      truncated: data.truncated,
      matches: data.matches,
    };
  }

  const creature = data; // a single CreatureDossier

  // Step 2 — decisive traits + factual implications, front-and-center.
  const tactics = deriveTactics(creature);
  const traitSet = new Set(tactics.map((t) => t.trait));

  // Step 3 — trimmed wiki strategy context. Best-effort: a missing page or a
  // network error becomes a note, never a throw.
  const wiki: WikiExcerpt[] = [];
  const notes: string[] = [];
  if (isProcedural(creature)) {
    notes.push(
      `"${creature.name}" (${creature.token}) is a procedural creature with no dedicated wiki page; ` +
        'strategy context is drawn from its traits and any relevant trait page.'
    );
  }

  for (const { topic, title } of wikiPlan(creature, traitSet)) {
    let res;
    try {
      res = await wikiLookupTool(title);
    } catch (err) {
      notes.push(`Wiki lookup for "${title}" failed: ${(err as Error).message}.`);
      continue;
    }
    if ('error' in res) {
      notes.push(`No wiki page for "${title}" (${res.error}).`);
      continue;
    }
    if (wiki.some((w) => w.title.toLowerCase() === res.title.toLowerCase())) continue; // dedupe
    wiki.push({ topic, title: res.title, url: res.url, excerpt: excerpt(res.text) });
  }

  if (wiki.length === 0 && notes.length === 0) {
    notes.push('No wiki context was looked up for this creature.');
  }

  const out: Identify = { query, creature, tactics, wiki };
  if (notes.length) out.notes = notes;
  return out;
}
