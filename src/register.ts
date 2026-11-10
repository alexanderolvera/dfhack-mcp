import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { NotConnectedError, TimeoutError } from './dfclient.ts';
import { ToolError, type ErrorCode, type ErrorPayload } from './errors.ts';

/** A no-argument, read-only tool that returns a JSON-able object. */
export interface ReadToolDef {
  name: string;
  title: string;
  description: string;
  run: () => Promise<unknown>;
  devOnly?: boolean;
  /** Mutates game state; registered only under DFHACK_MCP_ACTUATORS (see index.ts). */
  actuator?: boolean;
  /** Runs allowlisted DFHack commands; registered only under DFHACK_MCP_COMMANDS. */
  commands?: boolean;
  /** Served from the in-game snapshot; registered only under DFHACK_MCP_SNAPSHOT. */
  snapshot?: boolean;
  /** Emit compact JSON instead of pretty-printed. */
  compact?: boolean;
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
  /** Runs allowlisted DFHack commands; registered only under DFHACK_MCP_COMMANDS. */
  commands?: boolean;
  /** Served from the in-game snapshot; registered only under DFHACK_MCP_SNAPSHOT. */
  snapshot?: boolean;
  /** Emit compact JSON instead of pretty-printed. */
  compact?: boolean;
}

export type ToolDef = ReadToolDef | QueryToolDef;

/**
 * Whether a tool is withheld from registration under the given environment —
 * the single source of truth for the `devOnly`/`actuator`/`commands` gates, shared
 * by index.ts and scripts/verify.mjs so the two can never drift.
 * @param def A tool descriptor's `devOnly`/`actuator`/`commands` flags.
 * @param env Environment to gate against; defaults to `process.env`.
 * @returns True if the tool should not be registered.
 */
export function isGatedOff(
  def: Pick<ToolDef, 'devOnly' | 'actuator' | 'commands' | 'snapshot'>,
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    (!!def.devOnly && !env.DFHACK_MCP_DEV) ||
    (!!def.actuator && !env.DFHACK_MCP_ACTUATORS) ||
    (!!def.commands && !env.DFHACK_MCP_COMMANDS) ||
    (!!def.snapshot && !env.DFHACK_MCP_SNAPSHOT)
  );
}

function errorCodeOf(err: unknown): ErrorCode {
  if (err instanceof NotConnectedError) return 'NOT_CONNECTED';
  if (err instanceof TimeoutError) return 'TIMEOUT';
  if (err instanceof ToolError) return err.code;
  return 'SCRIPT_ERROR';
}

function errorPayload(name: string, err: unknown): string {
  const message =
    err instanceof NotConnectedError ? err.message : `${name} failed: ${(err as Error).message}`;
  const payload: ErrorPayload = { error: message, code: errorCodeOf(err) };
  return JSON.stringify(payload);
}

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

function registerQueryTool(server: McpServer, def: QueryToolDef): void {
  const { name, title, description, shape, run } = def;
  server.registerTool(name, { title, description, inputSchema: shape }, async (args) => {
    try {
      const data = await run(args);
      const text = def.compact ? JSON.stringify(data) : JSON.stringify(data, null, 2);
      return { content: [{ type: 'text', text }] };
    } catch (err) {
      return { content: [{ type: 'text', text: errorPayload(name, err) }], isError: true };
    }
  });
}

/**
 * Registers a tool from its descriptor, dispatching read vs. query on `shape`.
 * Does not apply the `devOnly`/`actuator`/`commands` gates — callers filter those first.
 * @param server The MCP server to register against.
 * @param def The tool's descriptor.
 */
export function registerTool(server: McpServer, def: ToolDef): void {
  if ('shape' in def) registerQueryTool(server, def);
  else registerReadTool(server, def);
}
