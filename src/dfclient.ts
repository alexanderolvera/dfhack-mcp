// Owns the single RPC connection to DFHack so tool handlers stay declarative.
// Lazy-connects on first use and transparently reconnects once if the socket
// has dropped (e.g. DF was restarted between calls).

import { DwarfClient } from 'dfhack-remote';

const HOST = process.env.DFHACK_HOST ?? '127.0.0.1';
const PORT = Number(process.env.DFHACK_PORT ?? 5000);

let client: DwarfClient | null = null;

async function ensureConnected(): Promise<DwarfClient> {
  if (client?.connected) return client;
  client = new DwarfClient({ host: HOST, port: PORT });
  await client.connect();
  return client;
}

/** True if we cannot even reach DFHack (vs. a fort-state or query error). */
export class NotConnectedError extends Error {}

/**
 * Run a Lua snippet and return its printed output, reconnecting once if the
 * socket dropped. Throws NotConnectedError if DFHack can't be reached at all.
 */
export async function runLua(snippet: string): Promise<string> {
  try {
    return await (await ensureConnected()).runLuaSnippet(snippet);
  } catch (err) {
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

export function closeConnection(): void {
  client?.close();
  client = null;
}
