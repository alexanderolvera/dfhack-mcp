import { runLua } from '../dfclient.ts';
import { z } from 'zod';
import type { ToolDef } from '../register.ts';

export async function runLuaTool(snippet: string): Promise<{ output: string }> {
  const output = await runLua(snippet);
  return { output };
}

export const runLuaDef: ToolDef = {
  name: 'run_lua',
  title: 'Run Lua (dev)',
  description:
    'DEV-ONLY escape hatch: run an arbitrary DFHack Lua snippet and return its ' +
    'printed output verbatim. Arbitrary Lua can READ AND WRITE game state, so ' +
    'this is not read-only; it is disabled unless DFHACK_MCP_DEV is set. ' +
    'Intended for probing fields while authoring curated tools, not for agents.',
  shape: { snippet: z.string().min(1).describe('DFHack Lua chunk; use print(...) to emit output') },
  run: ({ snippet }) => runLuaTool(snippet),
  devOnly: true,
};
