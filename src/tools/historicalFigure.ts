import { z } from 'zod';
import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface FigureRef {
  hf_id: number;
  name?: string;
  race?: string;
}

export interface Slayer {
  hf_id?: number;
  name?: string;
  race?: string;
  caste?: string;
}

export interface Death {
  year: number;
  event_id?: number;
  cause?: string;
  site_id?: number;
  site?: string;
  slayer?: Slayer;
}

export interface Position {
  position?: string;
  current: boolean;
  start_year?: number;
  end_year?: number;
}

export interface EntityAffiliation {
  entity_id: number;
  name?: string;
  name_english?: string;
  type?: string;
  links: string[];
  positions: Position[];
  positions_truncated?: boolean;
  positions_total?: number;
}

export interface Relationship extends FigureRef {
  type: string;
}

export interface Worship {
  hf_id: number;
  name?: string;
  strength: number;
}

export interface SiteLink {
  site_id: number;
  name?: string;
  name_english?: string;
  type?: string;
  link: string;
}

export interface Kill extends FigureRef {
  event_id: number;
  year: number;
  cause?: string;
  site_id?: number;
  site?: string;
}

export interface UnnamedKill {
  race: string;
  count: number;
}

export interface FigureEvent {
  event_id: number;
  year: number;
  type: string;
  site_id?: number;
}

export interface HistoricalFigure {
  hf_id: number;
  name?: string;
  name_english?: string;
  race?: string;
  caste?: string;
  sex?: string;
  profession?: string;
  deity?: boolean;
  force?: boolean;
  ghost?: boolean;
  spheres?: string[];
  alive: boolean;
  birth?: { year: number };
  death?: Death;
  unit_id?: number;
  entities: EntityAffiliation[];
  entities_truncated?: boolean;
  entities_total?: number;
  relationships: Relationship[];
  relationships_truncated?: boolean;
  relationships_total?: number;
  worship: Worship[];
  worship_truncated?: boolean;
  worship_total?: number;
  sites: SiteLink[];
  sites_truncated?: boolean;
  sites_total?: number;
  kills: Kill[];
  kills_truncated?: boolean;
  kills_total?: number;
  unnamed_kills: UnnamedKill[];
  unnamed_kills_truncated?: boolean;
  unnamed_kills_total?: number;
  events: FigureEvent[];
  events_truncated?: boolean;
  events_total?: number;
}

const LIST_FIELDS = ['entities', 'relationships', 'worship', 'sites', 'kills', 'unnamed_kills', 'events'];

function asList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function historicalFigure(hfId: number): Promise<HistoricalFigure | { error: string }> {
  const data = await runJsonScript<HistoricalFigure>('historicalFigure', [String(hfId)], LIST_FIELDS);
  if ('error' in data) return data;
  for (const entity of data.entities) {
    entity.links = asList(entity.links);
    entity.positions = asList(entity.positions);
  }
  if (data.spheres !== undefined) data.spheres = asList(data.spheres);
  return data;
}

export const historicalFigureDef: ToolDef = {
  name: 'historical_figure',
  title: 'Historical figure',
  description:
    "ONE historical figure's entry in the world's legends, by hf_id — works for the " +
    'dead as well as the living, and for figures who never set foot in the fort ' +
    '(deities, megabeasts, foreign generals). Returns name (native language + ' +
    'English), race/caste/sex, birth year, death (year, cause, site, and slayer with ' +
    "the slayer's hf_id), entity affiliations with positions held, relationships " +
    "(each with the related figure's hf_id, to chain back into this tool), " +
    'worshipped deities with strength, site links, kills of named figures plus ' +
    'per-race counts of unnamed kills, and the ids/types/years of saga events ' +
    'involving the figure. Every list is capped (most-recent-first where dated) ' +
    'with *_truncated/*_total present only when the cap dropped entries. unit_id ' +
    'appears only when the figure is a unit on this map on a discovered tile. ' +
    'Returns {"error":...} for an unknown hf_id or {"error":"no fort loaded"} if ' +
    'no fort is active.',
  shape: {
    hf_id: z.coerce
      .number()
      .int()
      .nonnegative()
      .describe("A historical figure id, e.g. a relationship's or slayer's hf_id"),
  },
  run: ({ hf_id }) => historicalFigure(hf_id),
};
