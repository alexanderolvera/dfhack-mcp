import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { QueryToolDef } from './register.ts';

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function opDigestOf(args: Record<string, unknown>): string {
  const rest = { ...args };
  delete rest.confirm_token;
  return stableStringify(rest);
}

/** What plan() (the dry-run) reports. */
export interface PlanResult {
  /** Facts about what applying would do — shown to the agent as the preview. */
  preview: Record<string, unknown>;
  /** Stable signature of the operation's OWN targets and their current state.
   *  If this differs between the preview call and the apply call, a target changed
   *  and the confirm_token is rejected. Encode ONLY the op's targets (e.g. the
   *  affected order id / tile set / detail membership), never the whole world —
   *  otherwise an unrelated change would needlessly void the token. */
  signature: string;
  /** If non-empty, the operation cannot be applied as specified and NO
   *  confirm_token is minted (e.g. malformed CSV cells, unsupported condition,
   *  no manager noble). These are facts, not advice. */
  blocked?: string[];
  /** True when applying would be a no-op (already in the desired state). A token
   *  is still minted, but apply() is skipped so the change is never silently
   *  doubled (idempotence audit, §A0). */
  noop?: boolean;
}

/** A query-level error surfaced by the underlying DFHack script — most importantly
 *  the `{ error: 'no fort loaded' }` guard, but also e.g. a script that failed to
 *  resolve. plan()/apply() may return this instead of their normal result; the
 *  wrapper passes it straight through as the tool's output (NOT isError), so the
 *  actuator honors the same no-fort contract as every read-only tool. */
export interface QueryError {
  error: string;
}

export function isQueryError(x: unknown): x is QueryError {
  return typeof x === 'object' && x !== null && typeof (x as QueryError).error === 'string';
}

/** What apply() returns once a valid token is redeemed. The wrapper adds the
 *  boolean `applied: true`, so these are the details alongside it. */
export interface ApplyResult {
  /** Facts about what changed. */
  changes: Record<string, unknown>;
  /** The undo handle + the concrete reversal path (§A0 documented reversal). */
  undo: Record<string, unknown>;
  /** Post-apply readback from the matching sensor, confirming the change is
   *  visible (§A0 post-apply readback). */
  readback: Record<string, unknown>;
}

export interface ActuatorDef<A extends { confirm_token?: string }> {
  name: string;
  title: string;
  description: string;
  /** Short token prefix for readability in transcripts, e.g. 'wo' | 'bp' | 'wd'. */
  tokenPrefix: string;
  /** The operation's own argument schema. `confirm_token` is added automatically. */
  shape: Record<string, z.ZodType>;
  /** Dry-run: compute the preview + a target signature. Called on both the preview
   *  call and (to re-derive the current signature) the apply call. Must not mutate.
   *  May return a QueryError (e.g. the no-fort guard) to short-circuit cleanly. */
  plan: (args: A) => Promise<PlanResult | QueryError>;
  /** Apply the fully-specified, confirmed operation. Only ever called after a valid,
   *  single-use token whose signature still matches the live state. May return a
   *  QueryError to short-circuit cleanly. */
  apply: (args: A, plan: PlanResult) => Promise<ApplyResult | QueryError>;
}

interface StoredToken {
  tool: string;
  /** Target-STATE signature — guards against the op's own targets drifting. */
  signature: string;
  /** Digest of the previewed operation's ARGS — guards against redeeming for a
   *  different operation that shares the same target-state signature. */
  opDigest: string;
}
const TOKENS = new Map<string, StoredToken>();
const MAX_TOKENS = 512;

function mint(tool: string, prefix: string, signature: string, opDigest: string): string {
  if (TOKENS.size >= MAX_TOKENS) {
    const oldest = TOKENS.keys().next().value;
    if (oldest !== undefined) TOKENS.delete(oldest);
  }
  const token = `${prefix}-${randomUUID()}`;
  TOKENS.set(token, { tool, signature, opDigest });
  return token;
}

function redeem(token: string, tool: string): StoredToken | null {
  const rec = TOKENS.get(token);
  if (!rec) return null;
  TOKENS.delete(token);
  return rec.tool === tool ? rec : null;
}

/** Test-only: clear the token store between cases. */
export function _resetTokens(): void {
  TOKENS.clear();
}

/**
 * Builds a gated actuator tool implementing the §A0 preview/confirm/apply
 * protocol, delegating only the DF-touching `plan()`/`apply()` bodies to the caller.
 * @param def The actuator's descriptor.
 * @returns A `QueryToolDef` flagged `actuator: true`.
 */
export function defineActuator<A extends { confirm_token?: string }>(
  def: ActuatorDef<A>
): QueryToolDef {
  const shape: Record<string, z.ZodType> = {
    ...def.shape,
    confirm_token: z
      .string()
      .optional()
      .describe(
        'Omit to DRY-RUN: returns a preview and a single-use confirm_token. ' +
          "Pass that token to APPLY. The token is void if the operation's own " +
          'targets change between preview and apply, and after one use.'
      ),
  };

  return {
    name: def.name,
    title: def.title,
    description: def.description,
    shape,
    actuator: true,
    run: async (args: A) => {
      const token = args.confirm_token;

      if (!token) {
        const plan = await def.plan(args);
        if (isQueryError(plan)) return plan;
        if (plan.blocked && plan.blocked.length) {
          return {
            mode: 'preview',
            applied: false,
            blocked: plan.blocked,
            preview: plan.preview,
          };
        }
        const confirm_token = mint(
          def.name,
          def.tokenPrefix,
          plan.signature,
          opDigestOf(args as Record<string, unknown>)
        );
        return {
          mode: 'preview',
          applied: false,
          preview: plan.preview,
          ...(plan.noop ? { would_be_noop: true } : {}),
          confirm_token,
        };
      }

      const rec = redeem(token, def.name);
      if (!rec) {
        throw new Error(
          'invalid or expired confirm_token; tokens are single-use — run a fresh preview'
        );
      }
      if (opDigestOf(args as Record<string, unknown>) !== rec.opDigest) {
        throw new Error(
          "the operation's arguments differ from the preview; the confirm_token is void — preview the exact operation you intend to apply"
        );
      }
      const plan = await def.plan(args);
      if (isQueryError(plan)) return plan;
      if (plan.blocked && plan.blocked.length) {
        throw new Error(`cannot apply: ${plan.blocked.join('; ')}`);
      }
      if (plan.signature !== rec.signature) {
        throw new Error(
          "the operation's own targets changed since preview; the confirm_token is void — re-preview"
        );
      }
      if (plan.noop) {
        return { mode: 'apply', applied: false, noop: true, preview: plan.preview };
      }
      const res = await def.apply(args, plan);
      if (isQueryError(res)) return res;
      return { mode: 'apply', applied: true, ...res };
    },
  };
}
