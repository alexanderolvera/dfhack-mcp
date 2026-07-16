// fort_status: one-call situational overview of the loaded fort.
// Thin wrapper over the FORT_STATUS Lua query — the query does the gathering
// and summarizing; here we just parse and normalize its JSON.

import { runLua } from '../dfclient.ts';
import { FORT_STATUS } from '../lua/queries.ts';

export interface FortStatus {
  fort_name: string;
  date: string;
  season: string;
  population: number;
  wealth: number;
  happiness: { miserable: number; unhappy: number; content: number; happy: number };
  alerts: string[];
}

export async function fortStatus(): Promise<FortStatus | { error: string }> {
  const raw = (await runLua(FORT_STATUS)).trim();
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`could not parse DFHack output as JSON: ${raw.slice(0, 300)}`);
  }
  if (data?.error) return data;
  // An empty Lua table encodes as {} rather than []; normalize the list field.
  if (!Array.isArray(data.alerts)) data.alerts = [];
  return data as FortStatus;
}
