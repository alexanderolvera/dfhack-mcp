import { fileURLToPath } from 'node:url';
import { DwarfClient, RpcError } from 'dfhack-remote-node';

const HOST = process.env.DFHACK_HOST ?? '127.0.0.1';
const PORT = Number(process.env.DFHACK_PORT ?? 5000);
const DEFAULT_TIMEOUT_MS = 30_000;
const TIMEOUT_MS = positiveOr(Number(process.env.DFHACK_MCP_TIMEOUT_MS), DEFAULT_TIMEOUT_MS);

const QUERY_DIR =
  process.env.DFHACK_MCP_QUERY_DIR ??
  fileURLToPath(new URL('./dfhack-queries/', import.meta.url)).replace(/\\/g, '/');

type RpcClient = Pick<
  DwarfClient,
  'connected' | 'connect' | 'close' | 'runLuaSnippet' | 'runCommand' | 'callLua'
>;

let createClient = (): RpcClient => new DwarfClient({ host: HOST, port: PORT });
let client: RpcClient | null = null;
let connecting: { c: RpcClient; ready: Promise<RpcClient> } | null = null;

function positiveOr(n: number, fallback: number): number {
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function registerScriptPath(c: RpcClient): Promise<void> {
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

function ensureConnected(): Promise<RpcClient> {
  if (client?.connected) return Promise.resolve(client);
  if (connecting) return connecting.ready;
  const c = createClient();
  const attempt = {
    c,
    ready: c
      .connect()
      .then(() => registerScriptPath(c))
      .then(() => c),
  };
  connecting = attempt;
  attempt.ready.then(
    () => {
      if (connecting === attempt) [client, connecting] = [c, null];
    },
    () => {
      if (connecting === attempt) connecting = null;
    }
  );
  return attempt.ready;
}

export class NotConnectedError extends Error {}

export class TimeoutError extends Error {}

async function withDeadline<T>(call: (c: RpcClient) => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new TimeoutError(
            `DFHack did not answer within ${TIMEOUT_MS} ms (DFHACK_MCP_TIMEOUT_MS); the connection ` +
              'was reset and the call was not retried, so it may have partly run in-game'
          )
        ),
      TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([ensureConnected().then(call), deadline]);
  } catch (err) {
    if (err instanceof TimeoutError) closeConnection();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const isFinal = (err: unknown): boolean => err instanceof RpcError || err instanceof TimeoutError;

async function withRetry<T>(call: (c: RpcClient) => Promise<T>): Promise<T> {
  try {
    return await withDeadline(call);
  } catch (err) {
    if (isFinal(err)) throw err;
    closeConnection();
    try {
      return await withDeadline(call);
    } catch (err2) {
      if (isFinal(err2)) throw err2;
      throw new NotConnectedError(
        `cannot reach DFHack on ${HOST}:${PORT} — is Dwarf Fortress running with DFHack? (${(err2 as Error).message})`
      );
    }
  }
}

/**
 * Runs a Lua snippet under the per-call deadline, reconnecting once if the socket dropped.
 * @param snippet Lua source to execute.
 * @returns The snippet's printed output.
 * @throws {RpcError} If DFHack ran the snippet and it failed.
 * @throws {TimeoutError} If DFHack did not answer within the deadline (never retried).
 * @throws {NotConnectedError} If DFHack can't be reached after the retry.
 */
export async function runLua(snippet: string): Promise<string> {
  return withRetry((c) => c.runLuaSnippet(snippet));
}

/**
 * Calls a function on an already-loaded `rpc.*` Lua module through the core RunLua RPC,
 * skipping DFHack's per-call script lookup, under the per-call deadline.
 * @param module Module name; DFHack only allows `rpc.*`, `*.rpc` or `*-rpc`.
 * @param fn Function name on that module.
 * @param args String arguments.
 * @returns The function's return values as strings.
 * @throws {RpcError} If DFHack rejected or failed the call.
 * @throws {TimeoutError} If DFHack did not answer within the deadline (never retried).
 * @throws {NotConnectedError} If DFHack can't be reached after the retry.
 */
export async function callLua(module: string, fn: string, args: string[] = []): Promise<string[]> {
  return withRetry((c) => c.callLua(module, fn, args));
}

/**
 * Invokes a registered query script by name with native argv, under the per-call
 * deadline, reconnecting once if the socket dropped.
 * @param name Bare query name (e.g. 'fortStatus'); the on-disk script is `mcp_<name>.lua`.
 * @param args Unescaped argv passed to the script as `local args = {...}`.
 * @returns The script's printed output.
 * @throws {RpcError} If DFHack ran the script and it failed.
 * @throws {TimeoutError} If DFHack did not answer within the deadline (never retried).
 * @throws {NotConnectedError} If DFHack can't be reached after the retry.
 */
export async function runScript(name: string, args: string[] = []): Promise<string> {
  return withRetry((c) => c.runCommand('mcp_' + name, args));
}

/**
 * Runs a DFHack command (built-in, plugin, or script) by its own name, under the
 * per-call deadline, reconnecting once if the socket dropped.
 * @param command The DFHack command name, e.g. 'seedwatch'.
 * @param args Unescaped argv for the command.
 * @returns The command's console output.
 * @throws {RpcError} If DFHack ran the command and it returned a non-OK result.
 * @throws {TimeoutError} If DFHack did not answer within the deadline (never retried).
 * @throws {NotConnectedError} If DFHack can't be reached after the retry.
 */
export async function runDfhackCommand(command: string, args: string[] = []): Promise<string> {
  return withRetry((c) => c.runCommand(command, args));
}

/** Closes the DFHack connection, including one still connecting; the next call reconnects. */
export function closeConnection(): void {
  client?.close();
  connecting?.c.close();
  client = null;
  connecting = null;
}

/**
 * Test-only: replaces the DFHack client constructor and drops the current connection.
 * @param factory Builds the client the next connection attempt uses.
 */
export function _setClientFactory(factory: () => RpcClient): void {
  closeConnection();
  createClient = factory;
}
