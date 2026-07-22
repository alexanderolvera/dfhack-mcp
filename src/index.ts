import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTool, isGatedOff } from './register.ts';
import { ALL_TOOLS } from './tools/registry.ts';
import { closeConnection } from './dfclient.ts';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

const server = new McpServer({ name: 'dfhack-mcp', version });

for (const def of ALL_TOOLS) {
  if (isGatedOff(def)) continue;
  registerTool(server, def);
}

const transport = new StdioServerTransport();
await server.connect(transport);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    closeConnection();
    process.exit(0);
  });
}
