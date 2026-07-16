// DFHack MCP server — exposes a live Dwarf Fortress fort to an AI agent as
// curated, semantic tools over stdio. Read-only (v1). This file is just the
// server wiring: construction, the tool list, and the stdio transport. The
// registration plumbing lives in register.ts; each tool in tools/.

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
import { defenses } from './tools/defenses.ts';
import { findUnit } from './tools/findUnit.ts';
import { gameData } from './tools/gameData.ts';
import { wikiSearchTool } from './tools/wikiSearch.ts';
import { wikiLookupTool } from './tools/wikiLookup.ts';
import { identify } from './tools/identify/index.ts';
import { runLuaTool } from './tools/runLua.ts';
import { registerReadTool, registerQueryTool } from './register.ts';
import { closeConnection } from './dfclient.ts';

const server = new McpServer({ name: 'dfhack-mcp', version: '0.1.0' });

registerReadTool(
  server,
  'fort_status',
  'Fort status',
  'One-call situational overview of the currently loaded Dwarf Fortress fort: ' +
    'name, in-game date and season, population, created wealth, a happiness ' +
    'breakdown (miserable/unhappy/content/happy), and a pre-triaged list of ' +
    'alerts worth attention. Returns {"error":"no fort loaded"} if no fort is active.',
  fortStatus
);

registerReadTool(
  server,
  'stocks',
  'Stocks',
  'Food and drink as estimated days-of-supply for the current population, plus ' +
    'counts of critical materials (wood, fuel, cloth, tanned hides, stone) and ' +
    'lists of notably low or high stocks. Days-of-supply assume ~2 food and ~5 ' +
    'drink per dwarf per season. Returns {"error":"no fort loaded"} if no fort is active.',
  stocks
);

registerReadTool(
  server,
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
  server,
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
  server,
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
  server,
  'military',
  'Military',
  "The fort's military: number of squads, how many living present dwarves are " +
    'actually enlisted (soldiers), filled squad positions, and readiness read ' +
    'against hostiles currently on the map (great-danger split out). Warns if ' +
    'the fort is undefended. Returns {"error":"no fort loaded"} if no fort is active.',
  military
);

registerReadTool(
  server,
  'injuries_and_health',
  'Injuries and health',
  "The fort's medical picture: how many dwarves are wounded, in the care " +
    'queue (patients), bedridden, or unconscious, plus a breakdown of what ' +
    'care is needed (diagnosis, surgery, suture, dressing, ...) so gaps in ' +
    'medical coverage are visible. Returns {"error":"no fort loaded"} if no ' +
    'fort is active.',
  injuriesAndHealth
);

registerReadTool(
  server,
  'defenses',
  'Defenses',
  'Where the threats are versus what you have to fight them with. Returns active ' +
    'hostiles with map positions and their tile-distance/direction to the fort ' +
    'core and to the nearest drawbridge, plus an inventory of controllable ' +
    'defensive structures (drawbridges with positions, levers, floodgates, ' +
    'hatches, cage traps, locked doors). Turns generic "atom-smash them" advice ' +
    'into a located plan. Walls/fortifications (map tiles) are not yet covered. ' +
    'Returns {"error":"no fort loaded"} if no fort is active.',
  defenses
);

registerQueryTool<{ query: string }>(
  server,
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

// --- Reference tier: game_data (this world's raws) + wiki (general knowledge) ---

registerQueryTool<{
  query: string;
  kind?: 'creature' | 'material' | 'plant' | 'reaction' | 'item' | 'building';
}>(
  server,
  'game_data',
  'Game data',
  "Look up the LOADED WORLD's raws (ground truth for THIS world) and return " +
    'curated, labeled facts. This is the authoritative source for procedural ' +
    'creatures (demons, forgotten beasts, titans) that never appear on the wiki. ' +
    'MVP covers the creature kind: pass a creature token (e.g. "DEMON_4"), a name ' +
    '(e.g. "flame phantom", case-insensitive substring), or a live unit_id (all ' +
    'digits) to get a dossier — token, name, size, notable flags, attacks, breath/' +
    'interactions, and a blurb. A single strong hit returns a full dossier; several ' +
    'return a disambiguation list. Other kinds (material/plant/reaction/item/building) ' +
    'report "not yet implemented". Returns {"error":"no game loaded"} if no game is active.',
  {
    query: z
      .string()
      .min(1)
      .describe('Creature token, name fragment, or a live unit_id (all digits)'),
    kind: z
      .enum(['creature', 'material', 'plant', 'reaction', 'item', 'building'])
      .optional()
      .describe(
        'Optional narrowing filter; defaults to creature. Only creature is implemented so far.'
      ),
  },
  ({ query, kind }) => gameData(query, kind)
);

registerQueryTool<{ query: string }>(
  server,
  'wiki_search',
  'Wiki search',
  'Search the Dwarf Fortress wiki (MediaWiki) for candidate article titles and ' +
    'cleaned snippets. Discovery/disambiguation step before wiki_lookup; biased ' +
    'to the DF2014 (Steam/Premium) namespace. Pure HTTP — works without the game ' +
    'running. Returns {results:[{title, snippet}]} (up to 8).',
  { query: z.string().min(1).describe('What to search the DF wiki for') },
  ({ query }) => wikiSearchTool(query)
);

registerQueryTool<{ title: string; section?: string; refresh?: boolean }>(
  server,
  'wiki_lookup',
  'Wiki lookup',
  'Fetch a Dwarf Fortress wiki article as clean, readable text, pinned to the ' +
    'DF2014 namespace. Follows redirects (multi-hop) and honors section ' +
    'fragments (e.g. "Weapon trap" resolves to the Weapon Trap section of the ' +
    'Trap page). Cache-first to disk (~30-day TTL); pass refresh:true to bypass. ' +
    'Pure HTTP — works without the game running. Returns {title, url, text, ' +
    'from_cache, resolved_from?} or {error} if the page is not found.',
  {
    title: z.string().min(1).describe('Article title or topic (namespace optional)'),
    section: z.string().optional().describe('Section/heading name to scope to'),
    refresh: z.boolean().optional().describe('Bypass the disk cache and refetch'),
  },
  ({ title, section, refresh }) => wikiLookupTool(title, section, refresh)
);

registerQueryTool<{ query: string }>(
  server,
  'identify',
  'Identify',
  'One-call "what is this creature and how do I handle it": fuses THIS WORLD\'s ' +
    'raws (ground truth) with the DF wiki (strategy). Pass a creature token ' +
    '(e.g. "DEMON_4"), a name ("flame phantom"), or a live unit_id (all digits) — ' +
    'same contract as game_data. Returns the creature dossier, a "tactics" list of ' +
    'the decisive traits with hard-fact implications (trapavoid, flier, fire, ' +
    'building_destroyer, webber, ranged breath weapons), and 1-2 trimmed wiki ' +
    'strategy excerpts. Procedural creatures (demons, forgotten beasts, titans) have ' +
    'no wiki page, so strategy leans on their traits plus the most relevant trait ' +
    'page. Use this instead of a bare wiki lookup so world-specific facts (e.g. a ' +
    'TRAPAVOID demon that cage traps cannot hold) are never missed. Multiple matches ' +
    'return a disambiguation list; returns {"error":"no game loaded"} if no game is active.',
  {
    query: z
      .string()
      .min(1)
      .describe('Creature token, name fragment, or a live unit_id (all digits)'),
  },
  ({ query }) => identify(query)
);

// Dev-only escape hatch. NOT registered by default: arbitrary Lua can mutate the
// game, so it breaks the read-only guarantee the curated tools uphold. Opt in
// with DFHACK_MCP_DEV=1 when probing fields while authoring new tools.
if (process.env.DFHACK_MCP_DEV) {
  registerQueryTool<{ snippet: string }>(
    server,
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
