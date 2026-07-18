// chronicle(since?, categories?, limit?): DF's announcement/report stream as
// triaged, cursor-addressable events. Passes native argv to mcp_chronicle.lua:
// [since, categories(comma-joined), limit]. The Lua reads the rolling, front-
// pruned df.global.world.status.reports window and returns id-addressable events
// with a save/load-stable cursor. See mcp_chronicle.lua for the confirmed field
// paths and the combat-collapse / pruning contract.

import { runJsonScript } from '../query.ts';
import { z } from 'zod';
import type { ToolDef } from '../register.ts';

/** The triage buckets a report can fall into; anything unmapped is "other". */
export type ChronicleCategory =
  | 'death'
  | 'birth'
  | 'marriage'
  | 'battle'
  | 'siege'
  | 'mood'
  | 'artifact'
  | 'migrants'
  | 'diplomacy'
  | 'cave-in'
  | 'megabeast'
  | 'other';

export interface ChronicleSpeaker {
  id: number;
  name?: string;
}

export interface ChronicleEvent {
  id: number; // report.id — monotonic, save/load-stable cursor unit
  category: ChronicleCategory;
  type: string; // announcement_type token, e.g. "COMBAT_DODGE"
  text?: string; // report text, with any continuation lines folded in
  color?: number;
  date: string; // in-game date, e.g. "19th Obsidian, Year 7"
  year?: number;
  time?: number; // tick-of-year
  repeat_count?: number; // native "(xN)"; present only when > 0
  continuation_lines?: number; // count of wrapped lines folded into `text`
  collapsed?: boolean; // a battle-run collapse marker (not a single report)
  collapsed_count?: number; // number of combat reports folded into this marker
  pos?: { x: number; y: number; z: number }; // tile anchor, when set
  speaker?: ChronicleSpeaker; // only when report.speaker_id != -1
}

export interface Chronicle {
  cursor: number; // highest retained id; pass back as `since` to resume
  oldest_retained_id?: number;
  newest_retained_id?: number;
  next_report_id?: number;
  window_size: number;
  since?: number;
  pruned: boolean; // `since` older than the retained window; earlier events gone
  pruned_note?: string;
  limit: number;
  count: number;
  more?: boolean; // older matching events exist beyond `limit`
  omitted_by_limit?: number;
  battle_collapsed: number; // combat reports folded into collapse markers
  filtered_categories?: string;
  order: 'ascending';
  events: ChronicleEvent[];
  note?: string;
}

export function chronicle(
  since?: number,
  categories?: string[],
  limit?: number
): Promise<Chronicle | { error: string }> {
  const args = [
    since != null ? String(since) : '',
    categories && categories.length > 0 ? categories.join(',') : '',
    limit != null ? String(limit) : '',
  ];
  return runJsonScript<Chronicle>('chronicle', args, ['events']);
}

const CHRONICLE_CATEGORIES = [
  'death',
  'birth',
  'marriage',
  'battle',
  'siege',
  'mood',
  'artifact',
  'migrants',
  'diplomacy',
  'cave-in',
  'megabeast',
  'other',
] as const;

export const chronicleDef: ToolDef = {
  name: 'chronicle',
  title: 'Chronicle',
  description:
    "The fort's announcement/report stream (combat, deaths, moods, artifacts, " +
    'sieges, migrants, ...) as triaged, cursor-addressable events. Reads the ' +
    'rolling, front-pruned report window. Each event carries a stable `id` ' +
    '(monotonic and save/load-stable); pass the returned top-level `cursor` back ' +
    'as `since` to fetch only newer events (id > since). Omitting `since` returns ' +
    'the most recent `limit` events (default 50, max 200), oldest-to-newest. If ' +
    '`since` predates the retained window the response sets pruned:true (earlier ' +
    'events are gone — not silently omitted). Events are triaged into categories ' +
    '(death, birth, marriage, battle, siege, mood, artifact, migrants, diplomacy, ' +
    'cave-in, megabeast, other); filter with `categories`. Combat spam is tamed: ' +
    'repeat_count is honored, wrapped continuation lines fold into their event, ' +
    'and long consecutive battle runs collapse into a single marker (collapsed:' +
    'true with collapsed_count) so one siege cannot flood the window — see ' +
    'battle_collapsed. Facts only: unit refs appear only when a report names a ' +
    'speaker (speaker_id != -1); combat reports carry no reliable unit, so they ' +
    'get a pos tile anchor instead. Returns {"error":"no fort loaded"} if no fort ' +
    'is active.',
  shape: {
    since: z.coerce
      .number()
      .int()
      .optional()
      .describe('Cursor: return only events with id greater than this (from a prior `cursor`).'),
    categories: z
      .preprocess(
        (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v),
        z.array(z.enum(CHRONICLE_CATEGORIES)).optional()
      )
      .describe(
        'Optional subset of categories to return: death, birth, marriage, battle, ' +
          'siege, mood, artifact, migrants, diplomacy, cave-in, megabeast, other.'
      ),
    limit: z.coerce
      .number()
      .int()
      .optional()
      .describe('Max events to return (default 50, capped at 200); newest are kept.'),
  },
  run: ({ since, categories, limit }) => chronicle(since, categories, limit),
};
