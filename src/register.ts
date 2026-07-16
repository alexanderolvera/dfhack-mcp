// Tool-registration helpers: wrap a tool handler so its result is JSON-stringified
// MCP content and errors become a uniform {error} payload. NotConnectedError (can't
// reach DFHack at all) passes its message through verbatim; anything else is framed
// as "<tool> failed: <message>". Keeps src/index.ts to server wiring + the tool list.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { NotConnectedError } from './dfclient.ts';

function errorPayload(name: string, err: unknown): string {
  const message =
    err instanceof NotConnectedError ? err.message : `${name} failed: ${(err as Error).message}`;
  return JSON.stringify({ error: message });
}

/** Register a no-argument, read-only tool that returns a JSON-able object. */
export function registerReadTool(
  server: McpServer,
  name: string,
  title: string,
  description: string,
  run: () => Promise<unknown>
): void {
  server.registerTool(name, { title, description }, async () => {
    try {
      const data = await run();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: errorPayload(name, err) }], isError: true };
    }
  });
}

/** Register a read-only tool that takes arguments matching `shape`. */
export function registerQueryTool<A>(
  server: McpServer,
  name: string,
  title: string,
  description: string,
  shape: Record<string, z.ZodType>,
  run: (args: A) => Promise<unknown>
): void {
  server.registerTool(name, { title, description, inputSchema: shape }, async (args) => {
    try {
      // The SDK infers a loose args shape from `shape`; the caller asserts the
      // concrete `A` it destructures, so narrow here at the single boundary.
      const data = await run(args as A);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: errorPayload(name, err) }], isError: true };
    }
  });
}
