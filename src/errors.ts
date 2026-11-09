export const ERROR_CODES = [
  'NOT_CONNECTED',
  'NO_FORT',
  'NO_GAME',
  'NOT_FOUND',
  'INVALID_ARGUMENT',
  'TIMEOUT',
  'SCRIPT_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorPayload {
  error: string;
  code: ErrorCode;
}

/** An error thrown by a tool's own TypeScript, carrying the code its payload reports. */
export class ToolError extends Error {
  readonly code: ErrorCode;

  constructor(message: string, code: ErrorCode) {
    super(message);
    this.code = code;
  }
}

const GUARD_CODES: Record<string, ErrorCode> = {
  'no fort loaded': 'NO_FORT',
  'no game loaded': 'NO_GAME',
};

/**
 * Adds the code for a shared Lua guard message (`no fort loaded`, `no game loaded`)
 * to a query script's `{error}` payload, leaving any code the script set itself.
 * @param payload The script's parsed `{error}` object.
 * @returns The same object, with `code` filled in when the message is a shared guard.
 */
export function withGuardCode<T extends { error: string; code?: string }>(payload: T): T {
  const code = GUARD_CODES[payload.error];
  if (payload.code === undefined && code) payload.code = code;
  return payload;
}
