// Shared plumbing for tools: run a Lua query that prints one JSON object,
// parse it, and normalize the given list fields (an empty Lua table encodes as
// {} rather than []). Query-level errors like {"error":"no fort loaded"} pass
// through untouched.

import { runLua } from './dfclient.ts';

export async function runJsonQuery<T>(
  snippet: string,
  listFields: string[] = []
): Promise<T | { error: string }> {
  const raw = (await runLua(snippet)).trim();
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`could not parse DFHack output as JSON: ${raw.slice(0, 300)}`);
  }
  if (data?.error) return data;
  for (const f of listFields) {
    if (!Array.isArray(data[f])) data[f] = [];
  }
  return data as T;
}
