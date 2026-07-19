// DFHack MCP server — exposes a live Dwarf Fortress fort to an AI agent as
// curated, semantic tools over stdio. Read-only BY DEFAULT: mutation lives only
// in `actuator` tools, which are gated off unless DFHACK_MCP_ACTUATORS is set.
// This file is just the server wiring: construction, registering the collected
// tools, and the stdio transport. Each tool's ToolDef (name/title/description/
// schema/handler) lives in its own module under tools/ and is collected in
// tools/registry.ts; the registration plumbing lives in register.ts.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTool, isGatedOff } from './register.ts';
import { ALL_TOOLS } from './tools/registry.ts';
import { closeConnection } from './dfclient.ts';

const server = new McpServer({ name: 'dfhack-mcp', version: '0.1.0' });

// Register every collected tool, honoring the two mutation gates. Gated-off tools
// do not appear in tools/list at all:
//   - devOnly (e.g. run_lua): off unless DFHACK_MCP_DEV — the raw Lua escape hatch.
//   - actuator (work_order_*, blueprint_*, assign_work_detail): off unless
//     DFHACK_MCP_ACTUATORS — these WRITE game state, so the default server stays
//     read-only. See src/actuator.ts for the §A0 dry-run/confirm/undo contract.
// isGatedOff (register.ts) is the shared predicate; verify.mjs derives the
// expected tools/list from the same function so the two never drift.
for (const def of ALL_TOOLS) {
  if (isGatedOff(def)) continue;
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
