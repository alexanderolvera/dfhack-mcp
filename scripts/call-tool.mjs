// End-to-end harness: spawn the MCP server over stdio, list tools, call one.
// Usage: node scripts/call-tool.mjs [toolName]   (default: fort_status)
// Requires Dwarf Fortress running with DFHack and a fort loaded.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const toolName = process.argv[2] ?? 'fort_status';

const transport = new StdioClientTransport({
  command: process.execPath, // node
  args: ['src/index.ts'],
});
const client = new Client({ name: 'dfhack-mcp-harness', version: '1.0.0' });

await client.connect(transport);

const { tools } = await client.listTools();
console.log(`server exposes: ${tools.map((t) => t.name).join(', ')}\n`);

const res = await client.callTool({ name: toolName, arguments: {} });
console.log(`${toolName} ->${res.isError ? ' (isError)' : ''}`);
for (const part of res.content) {
  if (part.type === 'text') console.log(part.text);
}

await client.close();
