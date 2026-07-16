// Owns the single RPC connection to DFHack so tool handlers stay declarative.
// Lazy-connects on first use and transparently reconnects once if the socket
// has dropped (e.g. DF was restarted between calls).
//
// The query layer is REAL .lua files in ./dfhack-queries/, invoked BY NAME with
// native argv. On every fresh connection we register that directory as a DFHack
// script path (once per connection), so `runScript('fortStatus', [...])` resolves
// to mcp_fortStatus.lua and DFHack runs it directly — no Lua source over the wire,
// no string escaping.

import { fileURLToPath } from 'node:url';
import { DwarfClient } from 'dfhack-remote-node';

const HOST = process.env.DFHACK_HOST ?? '127.0.0.1';
const PORT = Number(process.env.DFHACK_PORT ?? 5000);

// The directory holding mcp_*.lua, resolved relative to THIS module. In dev
// (type-stripped src/) this is src/dfhack-queries/; in the tsup bundle it is
// dist/dfhack-queries/ (tsup copies the .lua files there). DFHack needs forward
// slashes — backslashes fail addScriptPath on Windows.
const QUERY_DIR = fileURLToPath(new URL('./dfhack-queries/', import.meta.url)).replace(/\\/g, '/');

let client: DwarfClient | null = null;

/** Register the query dir as a DFHack script path for this connection. Feature-
 *  detects addScriptPath so an incompatible build fails with a clear message
 *  rather than a mysterious "command not found" later. */
async function registerScriptPath(c: DwarfClient): Promise<void> {
  const probe = (
    await c.runLuaSnippet(
      'print((dfhack.internal and dfhack.internal.addScriptPath) and "yes" or "no")'
    )
  ).trim();
  if (probe !== 'yes') {
    throw new Error(
      'this DFHack build lacks dfhack.internal.addScriptPath — cannot load the MCP query scripts ' +
        `from ${QUERY_DIR}`
    );
  }
  await c.runLuaSnippet(`dfhack.internal.addScriptPath([[${QUERY_DIR}]])`);
}

async function ensureConnected(): Promise<DwarfClient> {
  if (client?.connected) return client;
  const c = new DwarfClient({ host: HOST, port: PORT });
  await c.connect();
  // Register the script path ONCE per connection, before first use.
  await registerScriptPath(c);
  client = c;
  return client;
}

/** True if we cannot even reach DFHack (vs. a fort-state or query error). */
export class NotConnectedError extends Error {}

/**
 * Run a Lua snippet and return its printed output, reconnecting once if the
 * socket dropped. Throws NotConnectedError if DFHack can't be reached at all.
 * Kept for the run_lua dev tool and direct callers; the curated tools use
 * runScript instead.
 */
export async function runLua(snippet: string): Promise<string> {
  try {
    return await (await ensureConnected()).runLuaSnippet(snippet);
  } catch {
    // Reset and retry once — covers a stale socket after a DF restart.
    client = null;
    try {
      return await (await ensureConnected()).runLuaSnippet(snippet);
    } catch (err2) {
      throw new NotConnectedError(
        `cannot reach DFHack on ${HOST}:${PORT} — is Dwarf Fortress running with DFHack? (${(err2 as Error).message})`
      );
    }
  }
}

/**
 * Invoke a registered query script BY NAME with native argv and return its
 * printed output. `name` is the bare query name (e.g. 'fortStatus'); the on-disk
 * script is mcp_<name>.lua. Args arrive UNESCAPED as `local args = {...}`.
 * Reconnects once if the socket dropped (re-registering the script path via
 * ensureConnected), mirroring runLua's behavior.
 */
export async function runScript(name: string, args: string[] = []): Promise<string> {
  const command = 'mcp_' + name;
  try {
    return await (await ensureConnected()).runCommand(command, args);
  } catch {
    // Reset and retry once — a fresh ensureConnected re-registers the path.
    client = null;
    try {
      return await (await ensureConnected()).runCommand(command, args);
    } catch (err2) {
      throw new NotConnectedError(
        `cannot reach DFHack on ${HOST}:${PORT} — is Dwarf Fortress running with DFHack? (${(err2 as Error).message})`
      );
    }
  }
}

export function closeConnection(): void {
  client?.close();
  client = null;
}
