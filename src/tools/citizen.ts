import { runJsonScript } from '../query.ts';
import { z } from 'zod';
import type { ToolDef } from '../register.ts';

export interface Relation {
  name: string;
  unit_id?: number;
}

export interface ParentRelation extends Relation {
  relation: string;
}

export interface Friend extends Relation {
  affection: number;
  respect: number;
  meet_count?: number;
}

export interface Grudge extends Relation {
  love: number;
  trust: number;
  respect: number;
  loyalty: number;
  fear: number;
  negative_dims: string[];
  meet_count?: number;
}

export interface Relationships {
  spouse?: Relation;
  parents: ParentRelation[];
  children: Relation[];
  friends: Friend[];
  grudges: Grudge[];
  friends_total: number;
  grudges_total: number;
}

export interface FacetExtreme {
  facet: string;
  value: number;
  level: string;
}

export interface Deity {
  deity: string;
  strength?: number;
}

export interface SkillNote {
  skill: string;
  level: string;
  rating: number;
  rusty?: boolean;
}

export interface Thought {
  emotion?: string;
  about: string;
  severity?: number;
  year?: number;
}

export interface Physical {
  body_size_cm3?: number;
  size_modifier?: number;
  build?: string;
}

export interface Citizen {
  unit_id: number;
  name: string;
  profession?: string;
  sex?: string;
  age?: number;
  is_child?: boolean;
  stress: { level: string; value?: number; longterm?: number };
  personality: { extremes: FacetExtreme[] };
  relationships: Relationships;
  worship: Deity[];
  skills: SkillNote[];
  preferences: { likes: string[]; detests: string[] };
  physical: Physical;
  thoughts: Thought[];
}

const LIST_PATHS = [
  'personality.extremes',
  'relationships.parents',
  'relationships.children',
  'relationships.friends',
  'relationships.grudges',
  'worship',
  'skills',
  'preferences.likes',
  'preferences.detests',
  'thoughts',
];

function coerceList(root: Record<string, unknown>, path: string): void {
  const parts = path.split('.');
  let obj: Record<string, unknown> | undefined = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const next: unknown = obj[parts[i]];
    obj = next && typeof next === 'object' ? (next as Record<string, unknown>) : undefined;
    if (!obj) return;
  }
  const key = parts[parts.length - 1];
  if (obj && key in obj && !Array.isArray(obj[key])) obj[key] = [];
}

export async function citizen(unitId: string): Promise<Citizen | { error: string }> {
  const data = await runJsonScript<Citizen>('citizen', [unitId], []);
  if ('error' in data) return data;
  const root = data as unknown as Record<string, unknown>;
  for (const p of LIST_PATHS) coerceList(root, p);
  return data;
}

export const citizenDef: ToolDef = {
  name: 'citizen',
  title: 'Citizen',
  description:
    'A deep dossier on ONE citizen, chained by unit_id from find_unit (or ' +
    'chronicle). Where find_unit stays compact, this is the depth: the walkable ' +
    'social graph (spouse, parents, children, friends, grudges — each with a ' +
    'unit_id you can pass back into citizen() to walk the graph), worshipped ' +
    'deities with worship strength, NOTABLE personality extremes (only the top/' +
    'bottom facets, not the full 50-facet dump), skills of note, likes/detests, ' +
    'physical highlights, and recent thoughts as the game phrases them (raw ' +
    'caption templates that may contain unfilled [quality]/[deity]/[relation] ' +
    'placeholders, surfaced verbatim), tied to current stress. Friends are ' +
    'positive-affection acquaintances; grudges are bonds gone negative with no ' +
    'positive love to offset them (each carries its raw love/trust/respect ' +
    'scores plus negative_dims naming the negative dimensions, as labeled ' +
    'facts). Empty categories degrade to []. Facts ' +
    'only — it senses, it does not advise. Returns {"error":...} for a missing ' +
    'unit_id or {"error":"no fort loaded"} if no fort is active.',
  shape: {
    unit_id: z
      .string()
      .regex(/^\d+$/)
      .describe('A live unit_id (all digits), e.g. from a find_unit match'),
  },
  run: ({ unit_id }) => citizen(unit_id),
};
