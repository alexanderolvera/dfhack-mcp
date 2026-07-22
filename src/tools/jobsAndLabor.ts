import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface JobRow {
  job: string;
  count: number;
}

export interface CancelReasonRow {
  reason: string;
  count: number;
}

export interface Cancellations {
  total: number;
  by_reason: CancelReasonRow[];
  by_reason_truncated: boolean;
}

export interface JobsAndLabor {
  workforce: number;
  children: number;
  working: number;
  idle: number;
  idle_pct: number;
  top_jobs: JobRow[];
  cancellations: Cancellations;
  alerts: string[];
}

export async function jobsAndLabor(): Promise<JobsAndLabor | { error: string }> {
  const data = await runJsonScript<JobsAndLabor>('jobsAndLabor', [], ['top_jobs', 'alerts']);
  if ('error' in data) return data;
  if (data.cancellations && !Array.isArray(data.cancellations.by_reason)) {
    data.cancellations.by_reason = [];
  }
  return data;
}

export const jobsAndLaborDef: ToolDef = {
  name: 'jobs_and_labor',
  title: 'Jobs and labor',
  description:
    'Workforce utilization: how many working-age dwarves are busy vs. idle ' +
    '(children/babies excluded from the labor pool), the idle percentage, and ' +
    'a ranked breakdown of what jobs the fort is currently working on. High ' +
    'idle can mean unassigned labor or nothing queued. cancellations aggregates ' +
    'recent job-cancellation announcements (the currently-retained report ' +
    'buffer, roughly the last few months of play) by their reason text, sorted ' +
    'most-frequent first — a reason repeating many times (e.g. "Equipment ' +
    'mismatch") is spam pointing at one systemic cause; chronicle sees the same ' +
    'announcements one at a time but never aggregates them. Returns ' +
    '{"error":"no fort loaded"} if no fort is active.',
  run: jobsAndLabor,
};
