// DFHack MCP server — exposes a live Dwarf Fortress fort to an AI agent as
// curated, semantic tools over stdio. Read-only (v1). This file is just the
// server wiring: construction, registering the collected tools, and the stdio
// transport. Each tool's ToolDef (name/title/description/schema/handler) lives in
// its own module under tools/ and is collected in tools/registry.ts; the
// registration plumbing lives in register.ts.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTool } from './register.ts';
import { ALL_TOOLS } from './tools/registry.ts';
import { closeConnection } from './dfclient.ts';

const server = new McpServer({ name: 'dfhack-mcp', version: '0.1.0' });

// Register every collected tool. devOnly tools (e.g. run_lua, which can mutate
// game state and so breaks the read-only guarantee) stay off unless DFHACK_MCP_DEV
// is set — opt in when probing fields while authoring new tools.
for (const def of ALL_TOOLS) {
  if (def.devOnly && !process.env.DFHACK_MCP_DEV) continue;
  registerTool(server, def);
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
