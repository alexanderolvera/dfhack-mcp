// jobs_and_labor(): workforce utilization and what the fort is working on.
// Thin wrapper over the JOBS_AND_LABOR Lua query.

import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface JobRow {
  job: string;
  count: number;
}

export interface JobsAndLabor {
  workforce: number;
  children: number;
  working: number;
  idle: number;
  idle_pct: number;
  top_jobs: JobRow[];
  alerts: string[];
}

export function jobsAndLabor(): Promise<JobsAndLabor | { error: string }> {
  return runJsonScript<JobsAndLabor>('jobsAndLabor', [], ['top_jobs', 'alerts']);
}

export const jobsAndLaborDef: ToolDef = {
  name: 'jobs_and_labor',
  title: 'Jobs and labor',
  description:
    'Workforce utilization: how many working-age dwarves are busy vs. idle ' +
    '(children/babies excluded from the labor pool), the idle percentage, and ' +
    'a ranked breakdown of what jobs the fort is currently working on. High ' +
    'idle can mean unassigned labor or nothing queued. Returns ' +
    '{"error":"no fort loaded"} if no fort is active.',
  run: jobsAndLabor,
};
