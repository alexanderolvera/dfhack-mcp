// jobs_and_labor(): workforce utilization and what the fort is working on.
// Thin wrapper over the JOBS_AND_LABOR Lua query.

import { runJsonQuery } from '../query.ts';
import { JOBS_AND_LABOR } from '../dfhack-queries/jobsAndLabor.ts';

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
  return runJsonQuery<JobsAndLabor>(JOBS_AND_LABOR, ['top_jobs', 'alerts']);
}
