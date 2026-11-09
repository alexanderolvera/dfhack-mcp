import { runScript } from './dfclient.ts';
import { withGuardCode, type ErrorPayload } from './errors.ts';

/**
 * Runs a query script and parses its single JSON output, coercing the given
 * fields from Lua's empty-table `{}` to `[]`.
 * @param name Bare query name, passed through to `runScript`.
 * @param args Argv for the query script.
 * @param listFields Fields to normalize to `[]` when empty.
 * @returns The parsed payload, or the script's own `{error, code}` object, with the code
 *   filled in for the shared no-fort/no-game guards.
 * @throws {Error} If the script's output isn't valid JSON.
 */
export async function runJsonScript<T>(
  name: string,
  args: string[] = [],
  listFields: string[] = []
): Promise<T | ErrorPayload> {
  const raw = (await runScript(name, args)).trim();
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`could not parse DFHack output as JSON: ${raw.slice(0, 300)}`);
  }
  if (data?.error) return withGuardCode(data);
  for (const f of listFields) {
    if (!Array.isArray(data[f])) data[f] = [];
  }
  return data as T;
}
