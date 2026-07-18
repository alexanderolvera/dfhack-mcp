// citizen(unit_id): a deep dossier on ONE citizen, chained by unit_id from
// find_unit / chronicle. Where find_unit stays compact, this is the depth: the
// walkable social graph (spouse, parents, children, friends, grudges — each with
// a unit_id), worshipped deities, notable personality extremes, skills of note,
// likes/detests, physical highlights, and recent thoughts tied to current stress.
// Facts only — labeled facts, never advice. The Lua reads every version-fragile
// field defensively, so a missing field is a labeled fact, not a traceback.

import { runJsonScript } from '../query.ts';

/** A walkable edge in the social graph: a name plus the unit_id to chain on. */
export interface Relation {
  name: string;
  unit_id?: number; // absent when the figure is dead / off-map / not a live unit
}

export interface ParentRelation extends Relation {
  relation: string; // "mother" | "father"
}

export interface Friend extends Relation {
  affection: number; // core "love" score
  respect: number;
  meet_count?: number;
}

export interface Grudge extends Relation {
  love: number;
  trust: number;
  respect: number;
  loyalty: number;
  fear: number;
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
  value: number; // 0..100
  level: string; // very low | low | high | very high
}

export interface Deity {
  deity: string;
  strength?: number; // 0..100 worship link strength
}

export interface SkillNote {
  skill: string;
  level: string; // Dabbling..Legendary
  rating: number;
  rusty?: boolean;
}

export interface Thought {
  emotion?: string;
  about: string; // the game's own thought caption
  severity?: number;
  year?: number;
}

export interface Physical {
  body_size_cm3?: number;
  size_modifier?: number; // 100 = average
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

// Nested list fields (dot paths). An empty Lua table encodes as {} not [], so
// coerce every list back to an array — the generic runJsonScript helper only
// normalizes top-level fields, and citizen's lists are nested.
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
