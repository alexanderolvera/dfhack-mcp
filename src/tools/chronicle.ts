import { runJsonScript } from '../query.ts';
import { z } from 'zod';
import type { ToolDef } from '../register.ts';

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
  id: number;
  category: ChronicleCategory;
  type: string;
  text?: string;
  color?: number;
  date: string;
  year?: number;
  time?: number;
  repeat_count?: number;
  continuation_lines?: number;
  collapsed?: boolean;
  collapsed_count?: number;
  pos?: { x: number; y: number; z: number };
  speaker?: ChronicleSpeaker;
}

export interface Chronicle {
  cursor: number;
  oldest_retained_id?: number;
  newest_retained_id?: number;
  next_report_id?: number;
  window_size: number;
  since?: number;
  pruned: boolean;
  pruned_note?: string;
  limit: number;
  count: number;
  more?: boolean;
  omitted_by_limit?: number;
  battle_collapsed: number;
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
