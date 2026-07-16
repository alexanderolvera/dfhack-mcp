// run_lua(snippet): raw DFHack Lua escape hatch. DEV-ONLY — registered only when
// DFHACK_MCP_DEV is set, because arbitrary Lua can READ AND WRITE game state and
// therefore bypasses the read-only guarantee the other tools uphold.
//
// Returns the snippet's printed output verbatim (not parsed) so it stays useful
// for probing new fields while authoring the real, curated tools.

import { runLua } from '../dfclient.ts';

export async function runLuaTool(snippet: string): Promise<{ output: string }> {
  const output = await runLua(snippet);
  return { output };
}
