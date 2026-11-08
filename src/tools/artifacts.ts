import { runJsonScript } from '../query.ts';
import { z } from 'zod';
import type { ToolDef } from '../register.ts';

export interface MaterialRef {
  token: string;
  name?: string;
}

export interface ArtifactMaker {
  histfig_id: number;
  name?: string;
  unit_id?: number;
}

export interface Decoration {
  type: string;
  material?: MaterialRef;
  quality?: string;
  image_resolved?: boolean;
}

export interface Artifact {
  id: number;
  site_local?: boolean;
  name: { dwarven?: string; english?: string };
  item_type?: string;
  item_label?: string;
  material?: MaterialRef;
  value?: number;
  quality?: string;
  maker?: ArtifactMaker;
  decorations: Decoration[];
  decorations_truncated?: boolean;
  decorations_total?: number;
  inscription?: string;
  error?: string;
}

export interface ArtImageElement {
  type: string;
  name?: string;
  count?: number;
  race?: string;
  histfig_id?: number;
  unit_id?: number;
  plant?: string;
  shape?: string;
  item_type?: string;
  material?: MaterialRef;
}

export interface ArtImageProperty {
  type: string;
  verb?: string;
  subject?: number;
  object?: number;
  text?: string;
}

export interface ArtImage {
  elements: ArtImageElement[];
  properties: ArtImageProperty[];
  event?: { id: number; type?: string; year?: number };
  year?: number;
}

export interface EngravingSubject {
  subject: string;
  subject_resolved: boolean;
  ref: string;
  count: number;
  image?: ArtImage;
}

export interface Engraver {
  name?: string;
  histfig_id: number;
  unit_id?: number;
  count: number;
}

export interface EngravingsSummary {
  total_present: number;
  scanned: number;
  scan_truncated: boolean;
  distinct_subjects: number;
  art_images_loaded: boolean;
  subjects_resolvable: boolean;
  quality: Record<string, number>;
  by_subject: EngravingSubject[];
  by_subject_truncated: boolean;
  top_engravers: Engraver[];
}

export interface ArtifactsAndEngravings {
  scope: 'site' | 'world';
  artifacts: Artifact[];
  artifact_count: number;
  artifact_count_world: number;
  returned: number;
  cursor: number;
  next_cursor?: string;
  engravings: EngravingsSummary;
  caps: {
    default_limit: number;
    max_limit: number;
    decorations_per_artifact: number;
    engravings_scanned_max: number;
    subject_buckets_max: number;
    top_engravers_max: number;
  };
}

export async function artifactsAndEngravings(
  limit?: number,
  cursor?: string,
  scope?: 'site' | 'world'
): Promise<ArtifactsAndEngravings | { error: string }> {
  const data = await runJsonScript<ArtifactsAndEngravings>(
    'artifacts',
    [limit != null ? String(limit) : '', cursor ?? '', scope ?? ''],
    ['artifacts']
  );
  if ('error' in data) return data;

  const d = data as ArtifactsAndEngravings;
  for (const a of d.artifacts) {
    if (!Array.isArray(a.decorations)) a.decorations = [];
  }
  const e = d.engravings as EngravingsSummary & Record<string, unknown>;
  if (e) {
    if (!Array.isArray(e.by_subject)) e.by_subject = [];
    if (!Array.isArray(e.top_engravers)) e.top_engravers = [];
    if (Array.isArray(e.quality)) e.quality = {} as Record<string, number>;
  }
  return d;
}

export const artifactsAndEngravingsDef: ToolDef = {
  name: 'artifacts_and_engravings',
  title: 'Artifacts and engravings',
  description:
    "The fort's art, as labeled facts. Returns the named ARTIFACTS (paginated), " +
    'SITE-SCOPED BY DEFAULT — only artifacts belonging to the loaded fort, which ' +
    'is almost always what is meant by "our artifacts". Pass scope="world" for ' +
    "every artifact in the world (an old world holds hundreds that have nothing " +
    'to do with your fort; in world scope each row carries site_local so the two ' +
    'are still distinguishable). artifact_count always reflects the scope actually ' +
    'applied, and artifact_count_world always gives the unfiltered world total. ' +
    'Each artifact carries its name (dwarven + translated), item type and base material, ' +
    'created value, quality, maker (with a live unit_id ONLY when the maker is a ' +
    'living current citizen, else just the historical-figure name), the ' +
    'decorations on it (bands/covered/rings/images with their materials), and any ' +
    'engraved inscription text (e.g. a slab\'s secret). Plus an aggregated ' +
    'ENGRAVINGS summary for the map: engravings grouped BY SUBJECT with counts ' +
    '(never itemized per tile), a quality histogram, and the top engravers. ' +
    "Each subject bucket is one art image: subject is the image's title, and image " +
    'carries what it depicts: elements[] (creatures with race, histfig_id and a ' +
    'unit_id when the figure is a living citizen; items, plants, trees, shapes), ' +
    "properties[] (verbs linking elements by 0-based index, with DF's own sentence, " +
    'e.g. "X is raising the chert door."), and the history event the image ' +
    'commemorates when there is one. DF keeps art images on disk until something ' +
    'looks at them; this tool loads them the way the engraving view sheet does, ' +
    'paused and with the UI restored, but skips that while a view sheet is open. ' +
    'A subject whose image is still not loaded reports subject_resolved=false and ' +
    'falls back to its image reference ("image #0:70"), never a fabricated scene. Use ' +
    'limit + next_cursor to page through artifacts; see `caps` for all documented ' +
    'limits. Returns {"error":"no fort loaded"} if no fort is active.',
  shape: {
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Artifacts per page (default 25, max 100). Engravings are always fully aggregated.'),
    cursor: z
      .string()
      .optional()
      .describe('Opaque pagination cursor from a previous call\'s next_cursor; omit for the first page.'),
    scope: z
      .enum(['site', 'world'])
      .optional()
      .describe(
        'Which artifacts to return. "site" (default) = only this fort\'s artifacts. ' +
          '"world" = every artifact in the world, each tagged with site_local.'
      ),
  },
  run: ({ limit, cursor, scope }) => artifactsAndEngravings(limit, cursor, scope),
};
