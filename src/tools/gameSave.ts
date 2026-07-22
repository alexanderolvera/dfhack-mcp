import { runJsonScript } from '../query.ts';
import { defineActuator, type PlanResult, type ApplyResult } from '../actuator.ts';

interface SaveArgs {
  confirm_token?: string;
}

export const gameSaveDef = defineActuator<SaveArgs>({
  name: 'game_save',
  title: 'Save the game',
  description:
    'Checkpoint the fort with a quicksave — freezes the CURRENT game state to disk so a ' +
    'subsequent large or risky change can be rolled back by loading the save. ' +
    'EXECUTE-NEVER-DECIDE: takes no arguments; it saves the state as-is. Dry-run (no ' +
    'confirm_token) previews the fort and game date being frozen and mints a single-use ' +
    'confirm_token; pass it back to save. Facts to know: the write is ASYNCHRONOUS (DF ' +
    'commits the save over the next few frames — the readback confirms the quicksave ' +
    'command was dispatched, not that the file has landed) and it routes through DF’s ' +
    'AUTOSAVE, so the save lands in a rotating "autosave" folder per your DF settings ' +
    'rather than overwriting the loaded save. IRREVERSIBLE: to roll back, load the ' +
    'appropriate save/autosave in DF. Fortress mode only.',
  tokenPrefix: 'gs',
  shape: {},
  plan: async (): Promise<PlanResult | { error: string }> => {
    const r = await runJsonScript<PlanResult>('gameSave', ['plan']);
    return r as PlanResult | { error: string };
  },
  apply: async (): Promise<ApplyResult | { error: string }> => {
    const r = await runJsonScript<ApplyResult>('gameSave', ['apply']);
    return r as ApplyResult | { error: string };
  },
});
