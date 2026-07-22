import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const toolName = process.argv[2] ?? 'fort_status';
const toolArgs = Object.fromEntries(
  process.argv.slice(3).map((kv) => {
    const i = kv.indexOf('=');
    return i === -1 ? [kv, true] : [kv.slice(0, i), kv.slice(i + 1)];
  })
);

const transport = new StdioClientTransport({
  command: process.execPath, // node
  args: ['src/index.ts'],
  // StdioClientTransport spawns the child with a minimal env by default.
  env: { ...process.env },
});
const client = new Client({ name: 'dfhack-mcp-harness', version: '1.0.0' });

await client.connect(transport);

const { tools } = await client.listTools();
console.log(`server exposes: ${tools.map((t) => t.name).join(', ')}\n`);

const res = await client.callTool({ name: toolName, arguments: toolArgs });
console.log(`${toolName} ->${res.isError ? ' (isError)' : ''}`);
for (const part of res.content) {
  if (part.type === 'text') console.log(part.text);
}

await client.close();
