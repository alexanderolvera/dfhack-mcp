import { gameData, type CreatureDossier, type GameDataStub } from '../gameData.ts';
import { wikiLookupTool } from '../wikiLookup.ts';
import { excerpt, isProcedural, wikiPlan, type WikiExcerpt } from './wiki.ts';
import { z } from 'zod';
import type { ToolDef } from '../../register.ts';

export type { WikiExcerpt } from './wiki.ts';

export interface Identify {
  query: string;
  creature: CreatureDossier;
  wiki: WikiExcerpt[];
  notes?: string[];
}

export interface IdentifyDisambiguation {
  query: string;
  match_count: number;
  truncated?: boolean;
  matches: GameDataStub[];
}

export async function identify(
  query: string
): Promise<Identify | IdentifyDisambiguation | { error: string }> {
  const data = await gameData(query);
  if ('error' in data) return data;
  if ('match_count' in data) {
    return {
      query,
      match_count: data.match_count,
      truncated: data.truncated,
      matches: data.matches,
    };
  }

  // identify() only ever queries the default creature kind, so a single hit is always CreatureDossier.
  if (data.kind !== 'creature') {
    return { error: `expected a creature dossier, got kind '${data.kind}'` };
  }
  const creature = data;

  const wiki: WikiExcerpt[] = [];
  const notes: string[] = [];
  if (isProcedural(creature)) {
    notes.push(
      `"${creature.name}" (${creature.token}) is a procedural creature with no dedicated wiki page; ` +
        'strategy context is drawn from its traits and any relevant trait page.'
    );
  }

  for (const { topic, title } of wikiPlan(creature)) {
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
    if (wiki.some((w) => w.title.toLowerCase() === res.title.toLowerCase())) continue;
    wiki.push({ topic, title: res.title, url: res.url, excerpt: excerpt(res.text) });
  }

  if (wiki.length === 0 && notes.length === 0) {
    notes.push('No wiki context was looked up for this creature.');
  }

  const out: Identify = { query, creature, wiki };
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
    'same contract as game_data. Returns the creature dossier (flags, attacks, ' +
    'interactions — e.g. a TRAPAVOID flag means cage traps cannot hold it) plus 1-2 ' +
    'trimmed wiki strategy excerpts. Procedural creatures (demons, forgotten beasts, ' +
    'titans) have no wiki page, so strategy leans on their traits plus the most ' +
    'relevant trait page (fire, building destroyer). Use this instead of a bare wiki ' +
    'lookup so world-specific facts are never missed. Multiple matches return a ' +
    'disambiguation list; returns {"error":"no game loaded"} if no game is active.',
  shape: {
    query: z
      .string()
      .min(1)
      .describe('Creature token, name fragment, or a live unit_id (all digits)'),
  },
  run: ({ query }) => identify(query),
};
