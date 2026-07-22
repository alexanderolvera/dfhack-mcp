import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface MoodDemand {
  material: string;
  needed: number;
  gathered: number;
  have: number;
}

export type WorkshopStatus = 'unclaimed' | 'gathering' | 'working';

export interface Mood {
  unit_id: number;
  name: string;
  mood: 'fey' | 'secretive' | 'possessed' | 'macabre' | 'fell';
  skill: string;
  workshop: string | null;
  workshop_status: WorkshopStatus;
  mood_timeout: number;
  demands: MoodDemand[];
  demands_truncated: boolean;
}

export interface Moods {
  active: Mood[];
  active_truncated: boolean;
  alerts: string[];
}

export function moods(): Promise<Moods | { error: string }> {
  return runJsonScript<Moods>('moods', [], ['active', 'alerts']);
}

export const moodsDef: ToolDef = {
  name: 'moods',
  title: 'Strange moods',
  description:
    'Any active strange mood (fey/secretive/possessed/macabre/fell) and its ' +
    'material countdown. For each moody dwarf: the mood type, the driving skill, ' +
    'the workshop claimed (or that none is yet, via workshop_status: ' +
    'unclaimed/gathering/working), the raw mood countdown, and every demanded ' +
    'material cross-referenced against fort stock — needed, gathered so far, and ' +
    'how many the fort actually has (have). The early warning is "demands bones, ' +
    'fort has zero": it reports the demand vs. the stock, not what to go collect. ' +
    'Returns {"active":[]} when no strange mood is in progress (the common case), ' +
    'and {"error":"no fort loaded"} if no fort is active.',
  run: moods,
};
