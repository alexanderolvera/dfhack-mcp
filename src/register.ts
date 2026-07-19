// Tool-registration helpers: wrap a tool handler so its result is JSON-stringified
// MCP content and errors become a uniform {error} payload. NotConnectedError (can't
// reach DFHack at all) passes its message through verbatim; anything else is framed
// as "<tool> failed: <message>". Each tool ships its own ToolDef descriptor (see
// tools/*.ts); registerTool dispatches read vs. query on the presence of a `shape`.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { NotConnectedError } from './dfclient.ts';

/** A no-argument, read-only tool that returns a JSON-able object. */
export interface ReadToolDef {
  name: string;
  title: string;
  description: string;
  run: () => Promise<unknown>;
  devOnly?: boolean;
  /** Mutates game state; registered only under DFHACK_MCP_ACTUATORS (see index.ts). */
  actuator?: boolean;
}

/** A read-only tool that takes arguments matching `shape`. */
export interface QueryToolDef {
  name: string;
  title: string;
  description: string;
  shape: Record<string, z.ZodType>;
  run: (args: any) => Promise<unknown>;
  devOnly?: boolean;
  /** Mutates game state; registered only under DFHACK_MCP_ACTUATORS (see index.ts). */
  actuator?: boolean;
}

export type ToolDef = ReadToolDef | QueryToolDef;

function errorPayload(name: string, err: unknown): string {
  const message =
    err instanceof NotConnectedError ? err.message : `${name} failed: ${(err as Error).message}`;
  return JSON.stringify({ error: message });
}

/** Register a no-argument, read-only tool that returns a JSON-able object. */
function registerReadTool(server: McpServer, def: ReadToolDef): void {
  const { name, title, description, run } = def;
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
function registerQueryTool(server: McpServer, def: QueryToolDef): void {
  const { name, title, description, shape, run } = def;
  server.registerTool(name, { title, description, inputSchema: shape }, async (args) => {
    try {
      const data = await run(args);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: errorPayload(name, err) }], isError: true };
    }
  });
}

/** Register a tool from its descriptor, dispatching read vs. query on `shape`.
 *  `devOnly` is NOT handled here — the caller filters those before registering. */
export function registerTool(server: McpServer, def: ToolDef): void {
  if ('shape' in def) registerQueryTool(server, def);
  else registerReadTool(server, def);
}
