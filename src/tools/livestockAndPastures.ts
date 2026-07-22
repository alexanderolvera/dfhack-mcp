import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface AnimalRow {
  unit_id: number;
  name: string;
  species: string;
  sex?: 'male' | 'female';
  adult: boolean;
  training_level?: string;
}

export interface SpeciesGroup {
  species: string;
  sex?: 'male' | 'female';
  adult: boolean;
  count: number;
}

export interface CageRow {
  building_id: number;
  occupants: AnimalRow[];
}

export interface LivestockAndPastures {
  tame_total: number;
  pets: number;
  livestock: number;
  by_group: SpeciesGroup[];
  grazers: {
    total: number;
    pastured: number;
    unpastured: AnimalRow[];
    unpastured_truncated: boolean;
  };
  egg_layers: {
    total: number;
    nestbox_count: number;
    pastured_without_nestbox: number;
    unpastured: number;
  };
  marked_for_slaughter: AnimalRow[];
  marked_for_slaughter_truncated: boolean;
  trained: AnimalRow[];
  trained_truncated: boolean;
  cages: CageRow[];
  unassigned_count: number;
}

export function livestockAndPastures(): Promise<LivestockAndPastures | { error: string }> {
  return runJsonScript<LivestockAndPastures>('livestockAndPastures', [], [
    'by_group',
    'marked_for_slaughter',
    'trained',
    'cages',
  ]);
}

export const livestockAndPasturesDef: ToolDef = {
  name: 'livestock_and_pastures',
  title: 'Livestock and pastures',
  description:
    "The fort's tame animal economy as facts — every prior tool sees hostiles " +
    '(threats) or nothing at all here. tame_total/pets/livestock split ownership; ' +
    'by_group[] counts tame animals by species/sex/adult-or-not. grazers reports ' +
    'total vs pastured, plus the individual animals NOT in any pasture zone — a ' +
    'grazer with no pasture cannot graze and silently starves; this is normally ' +
    'invisible. egg_layers reports counts only (total, fort-wide nestbox count, how ' +
    'many are pastured without a nestbox in reach, how many are unpastured) since ' +
    'the consequence (missed eggs) is mild and the population is usually large. ' +
    'marked_for_slaughter and trained (training_level Trained..MasterfullyTrained) ' +
    'list individual animals, capped. cages[] lists occupied cages with their ' +
    'occupants (dfhack.buildings.getCageOccupants). unassigned_count is animals ' +
    'with no pasture, cage, or chain — DFHack\'s zone tool calls this "unassigned" ' +
    '(roaming loose); reported as a count only since it is commonly large and often ' +
    'intentional (e.g. free-roaming cats). Returns {"error":"no fort loaded"} if no ' +
    'fort is active.',
  run: livestockAndPastures,
};
