/**
 * @fileoverview Provides access to the loaded world's raw data (ground truth) across six dossier kinds:
 * creature, material, plant, reaction, item, building.
 * This is the authoritative source for procedural creatures that never appear on the wiki.
 */
import { runJsonScript } from '../query.ts';
import { z } from 'zod';
import type { ToolDef } from '../register.ts';

export type GameDataKind = 'creature' | 'material' | 'plant' | 'reaction' | 'item' | 'building';

export interface CreatureAttack {
  name: string;
  verb?: string;
}

export interface CreatureInteraction {
  name: string;
  material?: string;
}

/** A single strong hit: the full curated creature dossier for one raws creature. */
export interface CreatureDossier {
  kind: 'creature';
  token: string;
  name: string;
  plural?: string;
  caste_count: number;
  size: number;
  size_label: string;
  flags: string[];
  attacks: CreatureAttack[];
  interactions: CreatureInteraction[];
  description?: string;
  unit_id?: number;
  unit_name?: string;
}

export interface TempFact {
  urist: number;
  celsius: number;
}

export interface MaterialDossier {
  kind: 'material';
  token: string;
  name: string;
  state_names: { solid: string; liquid?: string; gas?: string };
  melting_point?: TempFact;
  boiling_point?: TempFact;
  ignite_point?: TempFact;
  flammable: boolean;
  density: { solid?: number; liquid?: number };
  flags: string[];
}

export interface PlantGrowth {
  token: string;
  name?: string;
}

export interface PlantMaterial {
  token: string;
  name: string;
}

export interface PlantDossier {
  kind: 'plant';
  token: string;
  name: string;
  plural?: string;
  type: string;
  farm_plantable: boolean;
  value: number;
  growth_time: number;
  seasons: string[];
  surface: boolean;
  depth_min: number;
  depth_max: number;
  biomes: string[];
  yields: string[];
  growths: PlantGrowth[];
  materials: PlantMaterial[];
}

export interface ReactionBuilding {
  category: string;
  workshop?: string;
  custom?: string;
}

export interface ReactionReagent {
  label?: string;
  quantity: number;
  item?: string;
  material?: string;
}

export interface ReactionProduct {
  item?: string;
  improvement?: string;
  quantity?: number;
  probability?: number;
}

export interface ReactionDossier {
  kind: 'reaction';
  token: string;
  name?: string;
  skill?: string;
  buildings: ReactionBuilding[];
  reagents: ReactionReagent[];
  products: ReactionProduct[];
}

export interface ItemAttack {
  verb?: string;
  contact: number;
  penetration: number;
  velocity_mult: number;
}

export interface ItemDossier {
  kind: 'item';
  token: string;
  name: string;
  plural?: string;
  adjective?: string;
  class: string;
  value?: number;
  stats: Record<string, string | number>;
  attacks?: ItemAttack[];
}

export interface BuildingReaction {
  token: string;
  name?: string;
}

export interface BuildingDossier {
  kind: 'building';
  token: string;
  name: string;
  category: string;
  purpose?: string;
  dim_x: number;
  dim_y: number;
  build_stages: number;
  reactions: BuildingReaction[];
  reactions_truncated?: boolean;
  reactions_total?: number;
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

export interface GameDataMatches {
  query: string;
  match_count: number;
  truncated?: boolean;
  matches: GameDataStub[];
}

export type GameData = Dossier | GameDataMatches;

const DOSSIER_LIST_FIELDS: Record<GameDataKind, string[]> = {
  creature: ['flags', 'attacks', 'interactions'],
  material: ['flags'],
  plant: ['seasons', 'biomes', 'yields', 'growths', 'materials'],
  reaction: ['buildings', 'reagents', 'products'],
  item: ['attacks'],
  building: ['reactions'],
};

const DOSSIER_OBJECT_FIELDS: Record<GameDataKind, string[]> = {
  creature: [],
  material: ['density'],
  plant: [],
  reaction: [],
  item: ['stats'],
  building: [],
};

export async function gameData(
  query: string,
  kind?: GameDataKind
): Promise<GameData | { error: string }> {
  const data = await runJsonScript<GameData>('gameData', [query, kind ?? ''], []);
  if ('error' in data) return data;

  const d = data as any;
  if ('match_count' in d) {
    if (!Array.isArray(d.matches)) d.matches = [];
  } else {
    const fields = DOSSIER_LIST_FIELDS[d.kind as GameDataKind] ?? [];
    for (const f of fields) {
      if (f in d && !Array.isArray(d[f])) d[f] = [];
    }
    const objFields = DOSSIER_OBJECT_FIELDS[d.kind as GameDataKind] ?? [];
    for (const f of objFields) {
      if (f in d && Array.isArray(d[f])) d[f] = {};
    }
  }
  return data;
}

export const gameDataDef: ToolDef = {
  name: 'game_data',
  title: 'Game data',
  description:
    "Look up the LOADED WORLD's raws (ground truth for THIS world) and return " +
    'curated, labeled facts. This is the authoritative source for procedural ' +
    'creatures (demons, forgotten beasts, titans) that never appear on the wiki. ' +
    'Covers six kinds via the `kind` filter (default creature): creature, ' +
    'material, plant, reaction, item, building. Pass a token (e.g. "DEMON_4", ' +
    '"INORGANIC:IRON", "MAKE_SOAP_FROM_TALLOW"), a name (case-insensitive ' +
    'substring, e.g. "flame phantom", "plump helmet"), or — for creature — a ' +
    'live unit_id (all digits). A single strong hit returns a full dossier for ' +
    'that kind; several return a disambiguation list; none returns ' +
    '{"match_count":0,"matches":[]}. Returns {"error":"no game loaded"} if no ' +
    'game is active.',
  shape: {
    query: z
      .string()
      .min(1)
      .describe(
        'A raws token or case-insensitive name fragment for the chosen kind ' +
          '(e.g. "IRON", "plump helmet", "MAKE_SOAP_FROM_TALLOW"); for the ' +
          'creature kind, a live unit_id (all digits) also resolves.'
      ),
    kind: z
      .enum(['creature', 'material', 'plant', 'reaction', 'item', 'building'])
      .optional()
      .describe(
        'Which raws table to search; defaults to creature. One of ' +
          'creature | material | plant | reaction | item | building.'
      ),
  },
  run: ({ query, kind }) => gameData(query, kind),
};
