import { z } from 'zod';
import { CR, RpcError } from 'dfhack-remote-node';
import { runDfhackCommand } from '../dfclient.ts';
import { runJsonScript } from '../query.ts';
import {
  defineActuator,
  isQueryError,
  type ApplyResult,
  type PlanResult,
  type QueryError,
} from '../actuator.ts';
import type { QueryToolDef } from '../register.ts';
import { ALLOWLIST, findAllowlisted, type AllowlistEntry } from './dfhackCommandAllowlist.ts';

export interface CommandEntry {
  name: string;
  help: string;
  tags: string[];
}

export interface TagEntry {
  tag: string;
  description: string;
}

export interface SeedwatchState {
  enabled: boolean;
  targets: { plant: string; usable: number; target: number }[];
}

interface ManagerOrder {
  id: number;
  job_type: string;
  reaction_name?: string;
  amount_total: number;
  amount_left: number;
}

interface RunArgs {
  command: string;
  args?: string[];
  confirm_token?: string;
}

const CR_NAMES = new Map<number, string>(
  Object.entries(CR).map(([name, code]) => [code as number, `CR_${name}`])
);

function crName(code: number): string {
  return CR_NAMES.get(code) ?? `CR_${code}`;
}

export function parseLs(text: string): CommandEntry[] {
  const entries: CommandEntry[] = [];
  let current: CommandEntry | null = null;
  let inTags = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim() === 'No matches.') continue;
    if (/^\S/.test(line)) {
      const [, name, help] = line.match(/^(\S+)\s*(.*)$/)!;
      current = { name, help: help.trim(), tags: [] };
      entries.push(current);
      inTags = false;
      continue;
    }
    if (!current) continue;
    const t = line.trim();
    if (t.startsWith('tags:')) {
      inTags = true;
      current.tags.push(...splitTags(t.slice(5)));
    } else if (inTags) {
      current.tags.push(...splitTags(t));
    } else {
      current.help = current.help ? `${current.help} ${t}` : t;
    }
  }
  return entries;
}

function splitTags(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

export function parseTags(text: string): TagEntry[] {
  const tags: TagEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = line.match(/^(\S+)\s+(.*)$/);
    if (m) tags.push({ tag: m[1], description: m[2].trim() });
    else if (tags.length) tags[tags.length - 1].description += ` ${line.trim()}`;
  }
  return tags;
}

export function parseSeedwatch(text: string): SeedwatchState {
  const targets = [...text.matchAll(/^\s*(\d+)\/(\d+)\s+(\S+)\s*$/gm)]
    .map((m) => ({ plant: m[3], usable: Number(m[1]), target: Number(m[2]) }))
    .sort((a, b) => (a.plant < b.plant ? -1 : a.plant > b.plant ? 1 : 0));
  return { enabled: /seedwatch is enabled/.test(text), targets };
}

export function seedwatchRestore(
  before: SeedwatchState,
  after: SeedwatchState
): { command: string; args: string[] }[] {
  const was = new Map(before.targets.map((t) => [t.plant, t.target]));
  const now = new Map(after.targets.map((t) => [t.plant, t.target]));
  const plants = [...new Set([...was.keys(), ...now.keys()])].sort();
  const restore = plants
    .filter((p) => (was.get(p) ?? 0) !== (now.get(p) ?? 0))
    .map((p) => ({ command: 'seedwatch', args: [p, String(was.get(p) ?? 0)] }));
  if (before.enabled !== after.enabled) {
    restore.push({ command: before.enabled ? 'enable' : 'disable', args: ['seedwatch'] });
  }
  return restore;
}

function instrumentBlock(listText: string, name: string): string | null {
  const blocks = listText.split(/\r?\n\s*\r?\n/).map((b) => b.trim());
  return blocks.find((b) => b.split(/\s/, 1)[0] === name) ?? null;
}

async function runCaptured(
  command: string,
  args: string[]
): Promise<{ ok: true; output: string } | { ok: false; command_result: string; output: string }> {
  try {
    return { ok: true, output: await runDfhackCommand(command, args) };
  } catch (err) {
    if (!(err instanceof RpcError)) throw err;
    return { ok: false, command_result: crName(err.code), output: err.text };
  }
}

function commandFailed(
  command: string,
  args: string[],
  r: { command_result: string; output: string }
): QueryError & Record<string, unknown> {
  return {
    error: 'command failed',
    command,
    args,
    command_result: r.command_result,
    output: r.output,
  };
}

async function seedwatchState(): Promise<SeedwatchState | QueryError> {
  const r = await runCaptured('seedwatch', ['status']);
  if (!r.ok) return commandFailed('seedwatch', ['status'], r);
  return parseSeedwatch(r.output);
}

async function managerOrders(): Promise<ManagerOrder[] | QueryError> {
  const r = await runJsonScript<{ orders: ManagerOrder[] }>('dfhackCommand', ['orders'], ['orders']);
  return isQueryError(r) ? r : r.orders;
}

function lineOf(command: string, args: string[]): string {
  return [command, ...args].join(' ');
}

function entryFor(args: RunArgs): AllowlistEntry {
  const entry = findAllowlisted(args.command, args.args ?? []);
  if (!entry) throw new Error(`not allowlisted: ${lineOf(args.command, args.args ?? [])}`);
  return entry;
}

async function plan(a: RunArgs): Promise<PlanResult | QueryError> {
  const entry = entryFor(a);
  const args = a.args ?? [];
  const fort = await runJsonScript('dfhackCommand', ['fort']);
  if (isQueryError(fort)) return fort;
  const base = {
    allowlist_entry: entry.id,
    command_line: lineOf(a.command, args),
    note: entry.note,
    native_dry_run: false,
  };
  if (entry.tracker === 'seedwatch') {
    const state = await seedwatchState();
    if (isQueryError(state)) return state;
    const targets = state.targets.map((t) => [t.plant, t.target]);
    return {
      preview: { ...base, seedwatch_now: state },
      signature: JSON.stringify({ enabled: state.enabled, targets }),
    };
  }
  if (entry.tracker === 'instrument_orders') {
    const list = await runCaptured('instruments', ['list']);
    if (!list.ok) return commandFailed('instruments', ['list'], list);
    const block = instrumentBlock(list.output, args[1]);
    const orders = await managerOrders();
    if (isQueryError(orders)) return orders;
    const preview = {
      ...base,
      quantity: Number(args[2] ?? 1),
      instrument: block ? block.split(/\r?\n/).map((l) => l.trim()) : null,
      manager_orders_now: orders.length,
    };
    if (!block) {
      return {
        preview,
        signature: '',
        blocked: [`no instrument named "${args[1]}" in this world's \`instruments list\` output`],
      };
    }
    return { preview, signature: block };
  }
  return { preview: base, signature: base.command_line };
}

async function apply(a: RunArgs, p: PlanResult): Promise<ApplyResult | QueryError> {
  const entry = entryFor(a);
  const args = a.args ?? [];
  const before =
    entry.tracker === 'seedwatch'
      ? await seedwatchState()
      : entry.tracker === 'instrument_orders'
        ? await managerOrders()
        : null;
  if (isQueryError(before)) return before;

  const r = await runCaptured(a.command, args);
  if (!r.ok) return commandFailed(a.command, args, r);
  const changes = { allowlist_entry: entry.id, command_line: p.preview.command_line, output: r.output };

  if (entry.tracker === 'seedwatch') {
    const after = await seedwatchState();
    if (isQueryError(after)) return after;
    return {
      changes,
      undo: {
        reversible: true,
        via: 'dfhack_command_run',
        commands: seedwatchRestore(before as SeedwatchState, after),
      },
      readback: { seedwatch: after },
    };
  }
  if (entry.tracker === 'instrument_orders') {
    const after = await managerOrders();
    if (isQueryError(after)) return after;
    const known = new Set((before as ManagerOrder[]).map((o) => o.id));
    const created = after.filter((o) => !known.has(o.id));
    return {
      changes,
      undo: {
        reversible: true,
        via: 'work_order_cancel',
        order_ids: created.map((o) => o.id),
        note: 'cancelling removes the orders; items they already produced stay',
      },
      readback: { orders_created: created },
    };
  }
  return { changes, undo: { reversible: false, note: entry.note }, readback: {} };
}

const mutator = defineActuator<RunArgs>({
  name: 'dfhack_command_run',
  title: 'Run an allowlisted DFHack command',
  description:
    "Run one of DFHack's own commands from a small, hand-reviewed allowlist, matched per " +
    'subcommand. EXECUTE-NEVER-DECIDE: runs exactly the command line given, or returns ' +
    '{"error":"not allowlisted"} with the allowlist, never forwarding anything else to DFHack. ' +
    'Read-only entries (seedwatch status, instruments list, prospect without all/hell) run ' +
    'directly and return the console output. Mutating entries (enable/disable seedwatch, ' +
    'seedwatch <PLANT_ID|all> <target>, seedwatch clear, instruments order <name> [qty]) use ' +
    'the dry-run/confirm loop: without confirm_token the preview reports the state the command ' +
    'acts on (DFHack has no native dry-run for these) and mints a single-use token; with it, ' +
    'the command runs and the result reports the console output, the readback, and the undo ' +
    '(prior seedwatch targets to restore, or the created manager order ids to cancel). ' +
    'Gated behind DFHACK_MCP_COMMANDS. Discover commands with dfhack_command_list.',
  tokenPrefix: 'dc',
  shape: {
    command: z.string().min(1).describe('DFHack command name, e.g. "seedwatch" or "instruments"'),
    args: z
      .array(z.string())
      .default([])
      .describe('Arguments, one per element, e.g. ["MUSHROOM_HELMET_PLUMP", "50"]'),
  },
  plan,
  apply,
});

function allowlistFacts(): { id: string; usage: string; access: string; note: string }[] {
  return ALLOWLIST.map(({ id, usage, access, note }) => ({ id, usage, access, note }));
}

export async function dfhackCommandRun(a: RunArgs): Promise<unknown> {
  const args = a.args ?? [];
  const entry = findAllowlisted(a.command, args);
  if (!entry) {
    return { error: 'not allowlisted', command: a.command, args, allowlist: allowlistFacts() };
  }
  if (entry.access === 'mutate') return mutator.run({ ...a, args });
  const r = await runCaptured(a.command, args);
  if (!r.ok) return commandFailed(a.command, args, r);
  return {
    allowlist_entry: entry.id,
    access: entry.access,
    command_line: lineOf(a.command, args),
    command_result: 'CR_OK',
    output: r.output,
  };
}

export const dfhackCommandRunDef: QueryToolDef = {
  ...mutator,
  actuator: false,
  commands: true,
  run: dfhackCommandRun,
};

const FILTER = /^[^-\s][^\s]*$/;
const HELPDB_LOCK_MISS = /^Failed Lua call to helpdb\.\S+ \(could not acquire core lock\)/;
const HELPDB_ATTEMPTS = 3;

async function runHelpdb(command: string, args: string[]): ReturnType<typeof runCaptured> {
  let r = await runCaptured(command, args);
  for (let i = 1; i < HELPDB_ATTEMPTS && r.ok && HELPDB_LOCK_MISS.test(r.output); i += 1) {
    r = await runCaptured(command, args);
  }
  if (r.ok && HELPDB_LOCK_MISS.test(r.output)) {
    return { ok: false, command_result: 'CR_OK', output: r.output };
  }
  return r;
}

export async function dfhackCommandList(filter?: string): Promise<unknown> {
  const tagsOut = await runHelpdb('tags', []);
  if (!tagsOut.ok) return commandFailed('tags', [], tagsOut);
  const tags = parseTags(tagsOut.output);
  const lsArgs = filter ? [filter] : [];
  const lsOut = await runHelpdb('ls', lsArgs);
  if (!lsOut.ok) return commandFailed('ls', lsArgs, lsOut);
  const commands = parseLs(lsOut.output);
  return {
    filter: filter ?? null,
    filter_kind: filter ? (tags.some((t) => t.tag === filter) ? 'tag' : 'search') : null,
    count: commands.length,
    commands,
    tags,
  };
}

export const dfhackCommandListDef: QueryToolDef = {
  name: 'dfhack_command_list',
  title: 'DFHack command list',
  description:
    "Every command DFHack itself ships (built-ins, plugins, scripts), from DFHack's own `ls`: " +
    'each command\'s name, one-line help, and tags, plus the full tag list from `tags` (each ' +
    'tag with its description). `filter` is a tag (e.g. "workorders") or a name substring ' +
    '(e.g. "seed"); a filter naming a tag lists that tag\'s commands. Reports what exists, not ' +
    'what to run. Developer-only commands (`ls --dev`) are not listed. Running a command is ' +
    'dfhack_command_run, which accepts only a small allowlist. Works without a fort loaded.',
  shape: {
    filter: z
      .string()
      .regex(FILTER, 'a single tag or search word, not an option')
      .optional()
      .describe('Tag (see `tags` in the result) or command-name substring'),
  },
  run: ({ filter }) => dfhackCommandList(filter),
};
