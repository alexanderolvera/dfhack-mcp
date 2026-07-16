// DFHack MCP server — exposes a live Dwarf Fortress fort to an AI agent as
// curated, semantic tools over stdio. Read-only (v1).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { fortStatus } from './tools/fortStatus.ts';
import { NotConnectedError, closeConnection } from './dfclient.ts';

const server = new McpServer({ name: 'dfhack-mcp', version: '0.1.0' });

server.registerTool(
  'fort_status',
  {
    title: 'Fort status',
    description:
      'One-call situational overview of the currently loaded Dwarf Fortress fort: ' +
      'name, in-game date and season, population, created wealth, a happiness ' +
      'breakdown (miserable/unhappy/content/happy), and a pre-triaged list of ' +
      'alerts worth attention. Returns {"error":"no fort loaded"} if no fort is active.',
  },
  async () => {
    try {
      const data = await fortStatus();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      const message =
        err instanceof NotConnectedError
          ? err.message
          : `fort_status failed: ${(err as Error).message}`;
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }
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
