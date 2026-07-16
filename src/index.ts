// DFHack MCP server — exposes a live Dwarf Fortress fort to an AI agent as
// curated, semantic tools over stdio. Read-only (v1).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { fortStatus } from './tools/fortStatus.ts';
import { stocks } from './tools/stocks.ts';
import { threats } from './tools/threats.ts';
import { unmetNeeds } from './tools/unmetNeeds.ts';
import { jobsAndLabor } from './tools/jobsAndLabor.ts';
import { military } from './tools/military.ts';
import { injuriesAndHealth } from './tools/injuriesAndHealth.ts';
import { findUnit } from './tools/findUnit.ts';
import { runLuaTool } from './tools/runLua.ts';
import { NotConnectedError, closeConnection } from './dfclient.ts';

const server = new McpServer({ name: 'dfhack-mcp', version: '0.1.0' });

/** Register a no-argument, read-only tool that returns a JSON-able object. */
function registerReadTool(name: string, title: string, description: string, run: () => Promise<unknown>) {
  server.registerTool(name, { title, description }, async () => {
    try {
      const data = await run();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      const message =
        err instanceof NotConnectedError ? err.message : `${name} failed: ${(err as Error).message}`;
      return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
    }
  });
}

/** Register a read-only tool that takes arguments matching `shape`. */
function registerQueryTool<A>(
  name: string,
  title: string,
  description: string,
  shape: Record<string, z.ZodType>,
  run: (args: A) => Promise<unknown>
) {
  server.registerTool(name, { title, description, inputSchema: shape }, async (args: A) => {
    try {
      const data = await run(args);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      const message =
        err instanceof NotConnectedError ? err.message : `${name} failed: ${(err as Error).message}`;
      return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
    }
  });
}

registerReadTool(
  'fort_status',
  'Fort status',
  'One-call situational overview of the currently loaded Dwarf Fortress fort: ' +
    'name, in-game date and season, population, created wealth, a happiness ' +
    'breakdown (miserable/unhappy/content/happy), and a pre-triaged list of ' +
    'alerts worth attention. Returns {"error":"no fort loaded"} if no fort is active.',
  fortStatus
);

registerReadTool(
  'stocks',
  'Stocks',
  'Food and drink as estimated days-of-supply for the current population, plus ' +
    'counts of critical materials (wood, fuel, cloth, tanned hides, stone) and ' +
    'lists of notably low or high stocks. Days-of-supply assume ~2 food and ~5 ' +
    'drink per dwarf per season. Returns {"error":"no fort loaded"} if no fort is active.',
  stocks
);

registerReadTool(
  'threats',
  'Threats',
  'Dangerous units currently on the map, grouped by creature type. Separates ' +
    'ACTIVE hostiles from CONTAINED ones (caged/chained), flags great-danger ' +
    'creatures (megabeasts, titans, demons, forgotten beasts), invaders, and ' +
    'the undead, and returns a pre-triaged alerts list. Returns ' +
    '{"error":"no fort loaded"} if no fort is active.',
  threats
);

registerReadTool(
  'unmet_needs',
  'Unmet needs',
  'Why the fort is stressed: the dwarven needs system aggregated across all ' +
    'citizens. Returns the top unmet needs (e.g. prayer, drink, socializing) ' +
    'ranked by how many dwarves are distracted, each with a concrete ' +
    'suggestion for what to build or do, plus how many dwarves have at least ' +
    'one unmet need. Complements fort_status happiness. Returns ' +
    '{"error":"no fort loaded"} if no fort is active.',
  unmetNeeds
);

registerReadTool(
  'jobs_and_labor',
  'Jobs and labor',
  'Workforce utilization: how many working-age dwarves are busy vs. idle ' +
    '(children/babies excluded from the labor pool), the idle percentage, and ' +
    'a ranked breakdown of what jobs the fort is currently working on. High ' +
    'idle can mean unassigned labor or nothing queued. Returns ' +
    '{"error":"no fort loaded"} if no fort is active.',
  jobsAndLabor
);

registerReadTool(
  'military',
  'Military',
  "The fort's military: number of squads, how many living present dwarves are " +
    'actually enlisted (soldiers), filled squad positions, and readiness read ' +
    'against hostiles currently on the map (great-danger split out). Warns if ' +
    'the fort is undefended. Returns {"error":"no fort loaded"} if no fort is active.',
  military
);

registerReadTool(
  'injuries_and_health',
  'Injuries and health',
  "The fort's medical picture: how many dwarves are wounded, in the care " +
    'queue (patients), bedridden, or unconscious, plus a breakdown of what ' +
    'care is needed (diagnosis, surgery, suture, dressing, ...) so gaps in ' +
    'medical coverage are visible. Returns {"error":"no fort loaded"} if no ' +
    'fort is active.',
  injuriesAndHealth
);

registerQueryTool<{ query: string }>(
  'find_unit',
  'Find unit',
  'Look up citizens by a name fragment or profession (case-insensitive, ' +
    'matches either). Returns a compact dossier per match: profession, age, ' +
    'stress level, current job, squad, and health flags (wounded/patient/' +
    'unconscious). Useful for questions like "how is the chief medical dwarf" ' +
    'or "find Urist". Returns {"error":"no fort loaded"} if no fort is active.',
  { query: z.string().min(1).describe('Name fragment or profession to search for') },
  ({ query }) => findUnit(query)
);

// Dev-only escape hatch. NOT registered by default: arbitrary Lua can mutate the
// game, so it breaks the read-only guarantee the curated tools uphold. Opt in
// with DFHACK_MCP_DEV=1 when probing fields while authoring new tools.
if (process.env.DFHACK_MCP_DEV) {
  registerQueryTool<{ snippet: string }>(
    'run_lua',
    'Run Lua (dev)',
    'DEV-ONLY escape hatch: run an arbitrary DFHack Lua snippet and return its ' +
      'printed output verbatim. Arbitrary Lua can READ AND WRITE game state, so ' +
      'this is not read-only; it is disabled unless DFHACK_MCP_DEV is set. ' +
      'Intended for probing fields while authoring curated tools, not for agents.',
    { snippet: z.string().min(1).describe('DFHack Lua chunk; use print(...) to emit output') },
    ({ snippet }) => runLuaTool(snippet)
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);

// stdio servers should exit quietly when the client closes the pipe.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    closeConnection();
    process.exit(0);
  });
}
