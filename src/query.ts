// Shared plumbing for tools: invoke a registered DFHack query script (a real
// mcp_<name>.lua file) by name with native argv, parse the one JSON object it
// prints, and normalize the given list fields (an empty Lua table encodes as
// {} rather than []). Query-level errors like {"error":"no fort loaded"} pass
// through untouched.

import { runScript } from './dfclient.ts';

export async function runJsonScript<T>(
  name: string,
  args: string[] = [],
  listFields: string[] = []
): Promise<T | { error: string }> {
  const raw = (await runScript(name, args)).trim();
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
