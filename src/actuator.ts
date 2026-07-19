// §A0 actuator contract — the shared machinery every mutating tool is built on.
// Spike #11 (issue #11) proved the plan → confirm → apply → readback → undo loop
// is drivable over RPC for manager orders, quickfort, and work details; this
// module encodes that loop ONCE so the three actuator tools only supply their
// version-fragile plan()/apply() bodies (which live in mcp_<name>.lua per repo
// convention).
//
// The contract, from issue #8 §A0:
//   - Execute, never decide: fully-specified args in; no strategy in defaults.
//   - Dry-run first: a call WITHOUT confirm_token returns a preview + a single-use
//     confirm_token. Applying requires a second call WITH that token.
//   - Token invalidated by changes to THE OPERATION'S OWN TARGETS (not any world
//     change): we re-run plan() at apply time and compare its signature to the
//     one the token was minted against. Tokens are also single-use.
//   - Documented reversal: apply() returns an `undo` handle; the tool description
//     names the reversal path.
//   - Idempotence: plan() can flag `noop` (already in the desired state) so apply
//     short-circuits instead of doubling.
//   - Post-apply readback: apply() returns a `readback` from the matching sensor.
//
// `defineActuator` yields a QueryToolDef flagged `actuator: true`, so index.ts
// keeps it out of the default (read-only) server unless DFHACK_MCP_ACTUATORS is set.

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { QueryToolDef } from './register.ts';

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
   *  call and (to re-derive the current signature) the apply call. Must not mutate. */
  plan: (args: A) => Promise<PlanResult>;
  /** Apply the fully-specified, confirmed operation. Only ever called after a valid,
   *  single-use token whose signature still matches the live state. */
  apply: (args: A, plan: PlanResult) => Promise<ApplyResult>;
}

// ---------------------------------------------------------------------------
// Single-use confirm-token store. In-memory and process-local: the MCP server is
// one long-lived process handling tool calls sequentially, so a Map suffices. A
// token binds to (tool, signature); redeem() always removes it (single-use) and
// only returns the record when the tool matches.
interface StoredToken {
  tool: string;
  signature: string;
}
const TOKENS = new Map<string, StoredToken>();

function mint(tool: string, prefix: string, signature: string): string {
  const token = `${prefix}-${randomUUID().slice(0, 8)}`;
  TOKENS.set(token, { tool, signature });
  return token;
}

/** Single-use: consumes the token whether or not it validates. Returns the stored
 *  record only if the token exists AND was minted for this tool; null otherwise. */
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

// ---------------------------------------------------------------------------

/** Build a gated actuator tool that implements the full §A0 two-call protocol,
 *  delegating only the DF-touching plan()/apply() bodies to the caller. */
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

      // ---- DRY-RUN (no token): preview + mint, or block with no token ---------
      if (!token) {
        const plan = await def.plan(args);
        if (plan.blocked && plan.blocked.length) {
          return {
            mode: 'preview',
            applied: false,
            blocked: plan.blocked,
            preview: plan.preview,
          };
        }
        const confirm_token = mint(def.name, def.tokenPrefix, plan.signature);
        return {
          mode: 'preview',
          applied: false,
          preview: plan.preview,
          ...(plan.noop ? { would_be_noop: true } : {}),
          confirm_token,
        };
      }

      // ---- APPLY (token present) ---------------------------------------------
      const rec = redeem(token, def.name);
      if (!rec) {
        throw new Error(
          'invalid or expired confirm_token; tokens are single-use — run a fresh preview'
        );
      }
      const plan = await def.plan(args); // re-derive the CURRENT signature
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
      return { mode: 'apply', applied: true, ...res };
    },
  };
}
