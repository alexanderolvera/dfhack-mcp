import { z } from 'zod';
import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface BlueprintLibraryEntry {
  id: number;
  path: string;
  mode: string;
  label?: string;
  comment?: string;
  cursor_start_hint?: string;
  library: boolean;
  hidden: boolean;
}

export interface BlueprintLibrary {
  entries: BlueprintLibraryEntry[];
  entries_total: number;
  entries_truncated: boolean;
  library_count: number;
  user_count: number;
}

export function blueprintLibrary(
  includeHidden?: boolean
): Promise<BlueprintLibrary | { error: string }> {
  const argv = includeHidden === false ? ['--no-hidden'] : [];
  return runJsonScript<BlueprintLibrary>('blueprint_library', argv, ['entries']);
}

export const blueprintLibraryDef: ToolDef = {
  name: 'blueprint_library',
  title: 'Blueprint library',
  description:
    "Lists quickfort blueprints available on disk — both DFHack's shipped library " +
    "(dreamfort, aquifer_tap, pump_stack, the bedrooms/tombs/exploratory-mining " +
    "collections, etc.) and the user's own dfhack-config/blueprints/ directory. " +
    'One entry per selectable modeline: a multi-phase file like dreamfort.csv lists ' +
    'separately as one entry per label (e.g. path="library/dreamfort.csv" ' +
    'label="surface1", label="farming2", ...), each with its own mode ' +
    '(dig/build/place/query/zone/meta/notes/...), comment (the blueprint\'s own ' +
    'help text), and cursor_start_hint (where quickfort suggests placing the cursor ' +
    'before applying, when the blueprint declares one). library:true marks a ' +
    "DFHack-shipped entry (path prefixed \"library/\"); library:false is the user's " +
    'own blueprint. library_count/user_count total each bucket; entries_total is the ' +
    'count before the 500-entry cap, which entries_truncated marks. ' +
    'hidden:true marks a blueprint its own modeline marks hidden — an internal helper ' +
    'phase not meant for direct selection, which plain `quickfort list` omits. These ARE ' +
    'listed by default, because they are applicable and omitting them silently hid most ' +
    "of DFHack's library (69 of 149 entries were listed before this). Pass " +
    'include_hidden=false for the `quickfort list` view. ' +
    'Feed an entry\'s path/label straight to blueprint_apply as ' +
    'blueprint_path/blueprint_label to designate it. CAVEAT: blueprint_apply is ' +
    'still dig+zone only, so entries whose mode is build/place/query/meta cannot ' +
    'be applied yet — for a multi-phase file like dreamfort that means its dig ' +
    'phases apply and its build/place phases do not. Returns ' +
    '{"error":"no fort loaded"} if no fort is active.',
  shape: {
    include_hidden: z
      .boolean()
      .optional()
      .describe('List blueprints their modeline marks hidden. Default true.'),
  },
  run: ({ include_hidden }: { include_hidden?: boolean }) => blueprintLibrary(include_hidden),
};
