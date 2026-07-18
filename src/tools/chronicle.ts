// chronicle(since?, categories?, limit?): DF's announcement/report stream as
// triaged, cursor-addressable events. Passes native argv to mcp_chronicle.lua:
// [since, categories(comma-joined), limit]. The Lua reads the rolling, front-
// pruned df.global.world.status.reports window and returns id-addressable events
// with a save/load-stable cursor. See mcp_chronicle.lua for the confirmed field
// paths and the combat-collapse / pruning contract.

import { runJsonScript } from '../query.ts';

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
