// jobs_and_labor(): workforce utilization and what the fort is working on.
// Thin wrapper over the JOBS_AND_LABOR Lua query.

import { runJsonScript } from '../query.ts';

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
