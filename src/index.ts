// DFHack MCP server — exposes a live Dwarf Fortress fort to an AI agent as
// curated, semantic tools over stdio. Read-only (v1).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { fortStatus } from './tools/fortStatus.ts';
import { stocks } from './tools/stocks.ts';
import { threats } from './tools/threats.ts';
import { unmetNeeds } from './tools/unmetNeeds.ts';
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

const transport = new StdioServerTransport();
await server.connect(transport);

// stdio servers should exit quietly when the client closes the pipe.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    closeConnection();
    process.exit(0);
  });
}
