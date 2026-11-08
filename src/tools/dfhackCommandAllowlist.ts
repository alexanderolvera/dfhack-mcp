export type Access = 'read' | 'mutate';
export type Tracker = 'seedwatch' | 'instrument_orders' | 'none';

export interface AllowlistEntry {
  id: string;
  command: string;
  usage: string;
  access: Access;
  tracker?: Tracker;
  note: string;
  accepts: (args: string[]) => boolean;
}

type Slot = string | RegExp;

const PLANT_OR_ALL = /^(?!status$|clear$)[A-Za-z0-9_]+$/;
const COUNT = /^\d+$/;
const INSTRUMENT = /^[^-\s][^\s]*$/;
const PROSPECT_SECTIONS =
  /^(summary|liquids|layers|features|ores|gems|veins|shrubs|trees)(,(summary|liquids|layers|features|ores|gems|veins|shrubs|trees))*$/;

function slotMatches(slot: Slot, arg: string): boolean {
  return typeof slot === 'string' ? slot === arg : slot.test(arg);
}

function forms(...shapes: Slot[][]): (args: string[]) => boolean {
  return (args) =>
    shapes.some((s) => s.length === args.length && s.every((slot, i) => slotMatches(slot, args[i])));
}

function prospectArgs(args: string[]): boolean {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '-v' || a === '--values') continue;
    if ((a === '-s' || a === '--show') && PROSPECT_SECTIONS.test(args[i + 1] ?? '')) {
      i += 1;
      continue;
    }
    return false;
  }
  return true;
}

export const ALLOWLIST: AllowlistEntry[] = [
  { id: 'enable seedwatch', command: 'enable', usage: 'enable seedwatch', access: 'mutate', tracker: 'seedwatch', accepts: forms(['seedwatch']), note: 'starts seedwatch; on a fresh fort it watches every seed at target 30; reversible with disable seedwatch plus the reported target restores' },
  { id: 'disable seedwatch', command: 'disable', usage: 'disable seedwatch', access: 'mutate', tracker: 'seedwatch', accepts: forms(['seedwatch']), note: 'stops seedwatch toggling cookability; the watch list is kept; reversible with enable seedwatch' },
  { id: 'instruments list', command: 'instruments', usage: 'instruments [list]', access: 'read', accepts: forms([], ['list']), note: "pure query of this world's instrument raws (skills, materials, handheld vs. building)" },
  { id: 'instruments order', command: 'instruments', usage: 'instruments order <instrument_name> [<quantity>]', access: 'mutate', tracker: 'instrument_orders', accepts: forms(['order', INSTRUMENT], ['order', INSTRUMENT, COUNT]), note: 'creates manager work orders for the instrument and each component; reversible by cancelling the reported order ids, items already made stay' },
  { id: 'prospect', command: 'prospect', usage: 'prospect [-s|--show <sections>] [-v|--values]', access: 'read', accepts: prospectArgs, note: 'pure query of the revealed map only; the all/hell keywords (which scan undiscovered tiles) are not allowlisted' },
  { id: 'seedwatch clear', command: 'seedwatch', usage: 'seedwatch clear', access: 'mutate', tracker: 'seedwatch', accepts: forms(['clear']), note: 'removes every type from the watch list; reversible by re-setting the prior targets reported in undo' },
  { id: 'seedwatch set', command: 'seedwatch', usage: 'seedwatch <PLANT_ID|all> <target>', access: 'mutate', tracker: 'seedwatch', accepts: forms([PLANT_OR_ALL, COUNT]), note: 'sets one (or all) seed targets, 0 removes the type; reversible by re-setting the prior targets reported in undo' },
  { id: 'seedwatch status', command: 'seedwatch', usage: 'seedwatch [status]', access: 'read', accepts: forms([], ['status']), note: 'pure query: enabled state, watch list, usable seed counts' },
];

/**
 * Finds the allowlist entry that accepts this exact command line.
 * @param command DFHack command name.
 * @param args The command's argv.
 * @returns The matching entry, or undefined if the command line is not allowlisted.
 */
export function findAllowlisted(command: string, args: string[]): AllowlistEntry | undefined {
  return ALLOWLIST.find((e) => e.command === command && e.accepts(args));
}
