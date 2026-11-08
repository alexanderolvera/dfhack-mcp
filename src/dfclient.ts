import { fileURLToPath } from 'node:url';
import { DwarfClient, RpcError } from 'dfhack-remote-node';

const HOST = process.env.DFHACK_HOST ?? '127.0.0.1';
const PORT = Number(process.env.DFHACK_PORT ?? 5000);

const QUERY_DIR =
  process.env.DFHACK_MCP_QUERY_DIR ??
  fileURLToPath(new URL('./dfhack-queries/', import.meta.url)).replace(/\\/g, '/');

let client: DwarfClient | null = null;

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
  await registerScriptPath(c);
  client = c;
  return client;
}

export class NotConnectedError extends Error {}

async function withRetry<T>(call: (c: DwarfClient) => Promise<T>): Promise<T> {
  try {
    return await call(await ensureConnected());
  } catch (err) {
    if (err instanceof RpcError) throw err;
    client = null;
    try {
      return await call(await ensureConnected());
    } catch (err2) {
      if (err2 instanceof RpcError) throw err2;
      throw new NotConnectedError(
        `cannot reach DFHack on ${HOST}:${PORT} — is Dwarf Fortress running with DFHack? (${(err2 as Error).message})`
      );
    }
  }
}

/**
 * Runs a Lua snippet, reconnecting once if the socket dropped.
 * @param snippet Lua source to execute.
 * @returns The snippet's printed output.
 * @throws {NotConnectedError} If DFHack can't be reached after the retry.
 */
export async function runLua(snippet: string): Promise<string> {
  return withRetry((c) => c.runLuaSnippet(snippet));
}

/**
 * Invokes a registered query script by name with native argv, reconnecting
 * once if the socket dropped.
 * @param name Bare query name (e.g. 'fortStatus'); the on-disk script is `mcp_<name>.lua`.
 * @param args Unescaped argv passed to the script as `local args = {...}`.
 * @returns The script's printed output.
 * @throws {NotConnectedError} If DFHack can't be reached after the retry.
 */
export async function runScript(name: string, args: string[] = []): Promise<string> {
  return withRetry((c) => c.runCommand('mcp_' + name, args));
}

/**
 * Runs a DFHack command (built-in, plugin, or script) by its own name, reconnecting
 * once if the socket dropped.
 * @param command The DFHack command name, e.g. 'seedwatch'.
 * @param args Unescaped argv for the command.
 * @returns The command's console output.
 * @throws {RpcError} If DFHack ran the command and it returned a non-OK result.
 * @throws {NotConnectedError} If DFHack can't be reached after the retry.
 */
export async function runDfhackCommand(command: string, args: string[] = []): Promise<string> {
  return withRetry((c) => c.runCommand(command, args));
}

export function closeConnection(): void {
  client?.close();
  client = null;
}
