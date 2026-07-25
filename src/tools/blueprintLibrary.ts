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
    "collections, etc.) and the user's own dfhack-config/blueprints/ directory — " +
    'that today\'s blueprint_apply/blueprint_undo (inline-CSV-only) leave invisible. ' +
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
    'CAVEAT: this is browsing only — blueprint_apply still requires the CSV pasted ' +
    'inline, so applying one of these still means sourcing its text yourself ' +
    '(library reference support is a planned follow-up). Returns ' +
    '{"error":"no fort loaded"} if no fort is active.',
  run: blueprintLibrary,
};
