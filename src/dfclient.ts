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

/**
 * Runs a Lua snippet, reconnecting once if the socket dropped.
 * @param snippet Lua source to execute.
 * @returns The snippet's printed output.
 * @throws {NotConnectedError} If DFHack can't be reached after the retry.
 */
export async function runLua(snippet: string): Promise<string> {
  try {
    return await (await ensureConnected()).runLuaSnippet(snippet);
  } catch (err) {
    if (err instanceof RpcError) throw err;
    client = null;
    try {
      return await (await ensureConnected()).runLuaSnippet(snippet);
    } catch (err2) {
      if (err2 instanceof RpcError) throw err2;
      throw new NotConnectedError(
        `cannot reach DFHack on ${HOST}:${PORT} — is Dwarf Fortress running with DFHack? (${(err2 as Error).message})`
      );
    }
  }
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
  const command = 'mcp_' + name;
  try {
    return await (await ensureConnected()).runCommand(command, args);
  } catch (err) {
    if (err instanceof RpcError) throw err;
    client = null;
    try {
      return await (await ensureConnected()).runCommand(command, args);
    } catch (err2) {
      if (err2 instanceof RpcError) throw err2;
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
