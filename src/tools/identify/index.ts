// identify(query): "what is this creature and how do I handle it" as ONE call.
// Fuses THIS WORLD's raws (ground truth) with the DF wiki (strategy). It does not
// re-read raws or re-implement wiki fetching — it COMPOSES game_data (resolution +
// dossier) and wiki_lookup (cleaned article text), then derives the decisive
// tactical traits (tactics.ts) so a caller can't miss them, and selects the
// worth-fetching wiki pages (wiki.ts).

import { gameData, type CreatureDossier, type GameDataStub } from '../gameData.ts';
import { wikiLookupTool } from '../wikiLookup.ts';
import { deriveTactics, type Tactic } from './tactics.ts';
import { excerpt, isProcedural, wikiPlan, type WikiExcerpt } from './wiki.ts';
import { z } from 'zod';
import type { ToolDef } from '../../register.ts';

export type { Tactic } from './tactics.ts';
export type { WikiExcerpt } from './wiki.ts';

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

  // identify() only ever asks game_data for the default creature kind, so a
  // single hit is always a CreatureDossier; narrow explicitly for the types.
  if (data.kind !== 'creature') {
    return { error: `expected a creature dossier, got kind '${data.kind}'` };
  }
  const creature = data;

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

export const identifyDef: ToolDef = {
  name: 'identify',
  title: 'Identify',
  description:
    'One-call "what is this creature and how do I handle it": fuses THIS WORLD\'s ' +
    'raws (ground truth) with the DF wiki (strategy). Pass a creature token ' +
    '(e.g. "DEMON_4"), a name ("flame phantom"), or a live unit_id (all digits) — ' +
    'same contract as game_data. Returns the creature dossier, a "tactics" list of ' +
    'the decisive traits with hard-fact implications (trapavoid, flier, fire, ' +
    'building_destroyer, webber, ranged breath weapons), and 1-2 trimmed wiki ' +
    'strategy excerpts. Procedural creatures (demons, forgotten beasts, titans) have ' +
    'no wiki page, so strategy leans on their traits plus the most relevant trait ' +
    'page. Use this instead of a bare wiki lookup so world-specific facts (e.g. a ' +
    'TRAPAVOID demon that cage traps cannot hold) are never missed. Multiple matches ' +
    'return a disambiguation list; returns {"error":"no game loaded"} if no game is active.',
  shape: {
    query: z
      .string()
      .min(1)
      .describe('Creature token, name fragment, or a live unit_id (all digits)'),
  },
  run: ({ query }) => identify(query),
};
