// game_data(query, kind?): look up the loaded world's raws (ground truth for
// THIS world) and return curated, labeled facts. MVP implements the CREATURE
// kind; other kinds report "not yet implemented". The Lua is centralized in
// src/dfhack-queries/mcp_gameData.lua with a per-kind dispatch so adding kinds
// later never adds a tool. See that file for the confirmed field paths.

import { runJsonScript } from '../query.ts';

export type GameDataKind = 'creature' | 'material' | 'plant' | 'reaction' | 'item' | 'building';

export interface CreatureAttack {
  name: string;
  verb?: string;
}

export interface CreatureInteraction {
  name: string; // human breath-weapon label, e.g. "Hurl fireball"
  material?: string; // emitted material token, e.g. CREATURE_MAT:DEMON_4:POISON
}

/** A single strong hit: the full curated creature dossier. */
export interface CreatureDossier {
  kind: 'creature';
  token: string; // creature_id, e.g. "DEMON_4"
  name: string; // singular name, e.g. "flame phantom"
  plural?: string;
  caste_count: number;
  size: number; // body volume, cm^3
  size_label: string; // tiny|small|medium|large|huge|gigantic
  flags: string[]; // curated advisor-relevant caste flags
  attacks: CreatureAttack[];
  interactions: CreatureInteraction[];
  description?: string;
  blurb?: string;
  unit_id?: number; // set when resolved via a live unit_id query
  unit_name?: string;
}

/** A temperature fact: the raw DF "urist" value plus its Celsius conversion. */
export interface TempFact {
  urist: number;
  celsius: number;
}

/** A single strong hit: a material dossier (via dfhack.matinfo). */
export interface MaterialDossier {
  kind: 'material';
  token: string; // e.g. "INORGANIC:IRON"
  name: string; // solid-state display name, e.g. "iron"
  state_names: { solid: string; liquid?: string; gas?: string };
  melting_point?: TempFact;
  boiling_point?: TempFact;
  ignite_point?: TempFact;
  flammable: boolean;
  density: { solid?: number; liquid?: number }; // kg/m^3
  flags: string[]; // curated notable material flags
}

export interface PlantGrowth {
  token: string;
  name?: string;
}

export interface PlantMaterial {
  token: string;
  name: string;
}

/** A single strong hit: a plant dossier. */
export interface PlantDossier {
  kind: 'plant';
  token: string;
  name: string;
  plural?: string;
  type: string; // tree|grass|shrub
  value: number;
  growth_time: number; // ticks to mature
  seasons: string[]; // SPRING|SUMMER|AUTUMN|WINTER
  surface: boolean;
  subterranean: boolean;
  depth_min: number;
  depth_max: number;
  biomes: string[];
  yields: string[]; // drink|seed|thread|mill|extract_*
  growths: PlantGrowth[];
  materials: PlantMaterial[];
}

export interface ReactionBuilding {
  category: string; // building_type, e.g. "Workshop"
  workshop?: string; // workshop_type / furnace_type, e.g. "Carpenters"
  custom?: string; // custom building_def token, when built at one
}

export interface ReactionReagent {
  label?: string;
  quantity: number;
  item?: string;
  material?: string;
}

export interface ReactionProduct {
  item?: string;
  improvement?: string; // non-item product (an improvement: glaze/encrust/stud/sew-image)
  quantity?: number; // absent on improvement products
  probability?: number;
}

/** A single strong hit: a reaction dossier. */
export interface ReactionDossier {
  kind: 'reaction';
  token: string;
  name?: string;
  skill?: string;
  building?: ReactionBuilding;
  reagents: ReactionReagent[];
  products: ReactionProduct[];
}

export interface ItemAttack {
  verb?: string;
  contact: number;
  penetration: number;
  velocity_mult: number;
}

/** A single strong hit: an itemdef dossier. */
export interface ItemDossier {
  kind: 'item';
  token: string;
  name: string;
  plural?: string;
  adjective?: string;
  class: string; // weapon|armor|tool|ammo|trapcomp|instrument|...
  value?: number; // absent on some classes (e.g. food)
  stats: Record<string, string | number>;
  attacks?: ItemAttack[];
}

export interface BuildingReaction {
  token: string;
  name?: string;
}

/** A single strong hit: a custom-building dossier. */
export interface BuildingDossier {
  kind: 'building';
  token: string;
  name: string;
  category: string; // building_type
  purpose?: string; // labor_description
  dim_x: number;
  dim_y: number;
  build_stages: number;
  reactions: BuildingReaction[];
}

export type Dossier =
  | CreatureDossier
  | MaterialDossier
  | PlantDossier
  | ReactionDossier
  | ItemDossier
  | BuildingDossier;

export interface GameDataStub {
  kind: GameDataKind;
  token: string;
  name: string;
  blurb: string;
}

/** Several hits (or none): a disambiguation list, mirroring find_unit. */
export interface GameDataMatches {
  query: string;
  match_count: number;
  truncated?: boolean;
  matches: GameDataStub[];
}

export type GameData = Dossier | GameDataMatches;

// Per-kind list fields that a dossier carries. An empty Lua table encodes as {}
// rather than [], so we coerce these back to arrays for the kind at hand only —
// never invent fields that a kind doesn't have.
const DOSSIER_LIST_FIELDS: Record<GameDataKind, string[]> = {
  creature: ['flags', 'attacks', 'interactions'],
  material: ['flags'],
  plant: ['seasons', 'biomes', 'yields', 'growths', 'materials'],
  reaction: ['reagents', 'products'],
  item: ['attacks'],
  building: ['reactions'],
};

// Per-kind OBJECT (map) fields. An empty Lua table encodes as [] not {}, so an
// empty map arrives as an array and violates the declared object type — coerce
// it back to {} for the kind at hand only.
const DOSSIER_OBJECT_FIELDS: Record<GameDataKind, string[]> = {
  creature: [],
  material: ['density'], // {solid?,liquid?} — empty when neither is known
  plant: [],
  reaction: [],
  item: ['stats'], // Record<string, string|number> — empty for e.g. food
  building: [],
};

export async function gameData(
  query: string,
  kind?: GameDataKind
): Promise<GameData | { error: string }> {
  const data = await runJsonScript<GameData>('gameData', [query, kind ?? ''], []);
  if ('error' in data) return data;

  // Normalize list fields per shape (an empty Lua table encodes as {} not []).
  const d = data as any;
  if ('match_count' in d) {
    if (!Array.isArray(d.matches)) d.matches = [];
  } else {
    const fields = DOSSIER_LIST_FIELDS[d.kind as GameDataKind] ?? [];
    for (const f of fields) {
      // item.attacks is optional (nil for non-weapons) — only coerce when present.
      if (f in d && !Array.isArray(d[f])) d[f] = [];
    }
    const objFields = DOSSIER_OBJECT_FIELDS[d.kind as GameDataKind] ?? [];
    for (const f of objFields) {
      // An empty object came back as [] — restore it to {} to match the type.
      if (f in d && Array.isArray(d[f])) d[f] = {};
    }
  }
  return data;
}
