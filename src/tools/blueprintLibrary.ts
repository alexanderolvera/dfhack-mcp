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
}

export interface BlueprintLibrary {
  entries: BlueprintLibraryEntry[];
  entries_total: number;
  entries_truncated: boolean;
  library_count: number;
  user_count: number;
}

export function blueprintLibrary(): Promise<BlueprintLibrary | { error: string }> {
  return runJsonScript<BlueprintLibrary>('blueprint_library', [], ['entries']);
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
    'unfiltered count and entries_truncated marks overflow past the 500-entry cap. ' +
    'Blueprints marked hidden in their modeline (internal helper phases not meant ' +
    'for direct selection) are omitted, matching plain `quickfort list`. ' +
    'Feed an entry\'s path/label straight to blueprint_apply as ' +
    'blueprint_path/blueprint_label to designate it. CAVEAT: blueprint_apply is ' +
    'still dig+zone only, so entries whose mode is build/place/query/meta cannot ' +
    'be applied yet — for a multi-phase file like dreamfort that means its dig ' +
    'phases apply and its build/place phases do not. Returns ' +
    '{"error":"no fort loaded"} if no fort is active.',
  run: blueprintLibrary,
};
