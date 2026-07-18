// artifacts_and_engravings(limit?, cursor?): the fort's named artifacts
// (paginated) plus an aggregated summary of the map's engravings. Facts only —
// this senses the fort's art, it never advises. Thin wrapper over the ARTIFACTS
// Lua query (src/dfhack-queries/mcp_artifacts.lua), which owns every confirmed,
// version-fragile field path.

import { runJsonScript } from '../query.ts';

/** A material reference: its raws token plus a readable name. */
export interface MaterialRef {
  token: string; // e.g. "INORGANIC:MICROCLINE"
  name?: string; // e.g. "microcline"
}

/** The maker of an artifact. unit_id is set ONLY for a living current citizen. */
export interface ArtifactMaker {
  histfig_id: number;
  name?: string;
  unit_id?: number; // present only when the maker is a living current citizen
  is_current_citizen: boolean;
}

/** One decoration (item improvement) on an artifact. */
export interface Decoration {
  type: string; // df.improvement_type, e.g. BANDS | COVERED | ART_IMAGE | RINGS_HANGING
  material?: MaterialRef;
  quality?: string;
  image_resolved?: boolean; // ART_IMAGE only: false when the depicted scene isn't loaded
}

/** One artifact record. */
export interface Artifact {
  id: number;
  name: { dwarven?: string; english?: string };
  item_type?: string; // df.item_type, e.g. SLAB | SHIELD | SCEPTER
  item_label?: string; // readable base label, e.g. "microcline slab"
  material?: MaterialRef;
  value?: number;
  quality?: string; // df.item_quality label, e.g. "Masterful"
  maker?: ArtifactMaker;
  decorations: Decoration[];
  decorations_truncated?: boolean;
  decorations_total?: number;
  inscription?: string; // engraved text (slabs); the storytelling gold
  error?: string; // set only when a single record was unreadable
}

/** One aggregated engraving subject bucket (never itemized per tile). */
export interface EngravingSubject {
  subject: string; // resolved scene text, or "image #<art_id>:<subid>" when unresolvable
  subject_resolved: boolean;
  ref: string; // stable art-image reference "<art_id>:<subid>"
  count: number;
}

/** One prolific engraver. */
export interface Engraver {
  name?: string;
  histfig_id: number;
  unit_id?: number; // present only when the engraver is a living current citizen
  count: number;
}

/** The aggregated engravings summary. */
export interface EngravingsSummary {
  total_present: number;
  scanned: number;
  scan_truncated: boolean;
  distinct_subjects: number;
  subjects_resolvable: boolean; // false when art images aren't loaded (scene text unavailable)
  quality: Record<string, number>; // quality label -> count
  by_subject: EngravingSubject[];
  by_subject_truncated: boolean;
  top_engravers: Engraver[];
}

export interface ArtifactsAndEngravings {
  artifacts: Artifact[];
  artifact_count: number; // total artifacts (across all pages)
  returned: number;
  cursor: number;
  next_cursor?: string; // pass back as `cursor` for the next page; absent at the end
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
  cursor?: string
): Promise<ArtifactsAndEngravings | { error: string }> {
  const data = await runJsonScript<ArtifactsAndEngravings>(
    'artifacts',
    [limit != null ? String(limit) : '', cursor ?? ''],
    ['artifacts']
  );
  if ('error' in data) return data;

  // An empty Lua table encodes as {} not [], and an empty map encodes as [] not
  // {} — coerce the nested collections back to their declared shapes.
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
