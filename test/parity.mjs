// Read-source parity specs — see docs/VERIFY.md's "Read-source parity" section for
// the pause-aware rule and the { tool, calls, stable, drifting, rows, identity,
// volatile } shape. Adding a dual-path tool is one entry here.
import { isDeepStrictEqual } from 'node:util';

export const PARITY_SPECS = [
  {
    tool: 'find_unit',
    calls: [
      { query: 'a' },
      { query: 'e' },
      { query: 'miner' },
      { query: 'medical' },
      { query: 'Urist' },
      { query: 'zzzznomatch' },
    ],
    stable: ['query', 'match_count', 'truncated'],
    rows: 'matches',
    identity: ['unit_id', 'name', 'profession', 'age', 'squad'],
    volatile: ['current_job', 'stress', 'wounded', 'patient', 'unconscious'],
  },
  {
    tool: 'map_overview',
    calls: [{}],
    stable: ['extents', 'fog_of_war'],
    drifting: [
      'fort_core',
      'surface_z_at_core',
      'activity',
      'stair_columns',
      'stair_columns_total',
      'stair_columns_truncated',
    ],
  },
];

const PROVENANCE_KEYS = ['source', 'snapshot'];
const brief = (v) => JSON.stringify(v ?? null).slice(0, 200);

/** The payload without its provenance, which is the one part that must differ. */
export function stripProvenance(payload) {
  const out = { ...payload };
  for (const key of PROVENANCE_KEYS) delete out[key];
  return out;
}

/** Problems with a payload's read-source report, as human strings. */
export function sourceProblems(payload, expected) {
  const problems = [];
  if (payload?.source !== expected)
    problems.push(`source is ${brief(payload?.source)}, expected "${expected}"`);
  if (expected === 'live') {
    if (payload?.snapshot !== undefined) problems.push('a live read carries snapshot provenance');
    return problems;
  }
  const walkers = Object.entries(payload?.snapshot ?? {});
  if (!walkers.length) problems.push('a snapshot read carries no snapshot.<walker> provenance');
  for (const [walker, p] of walkers) {
    if (!Number.isInteger(p?.seq)) problems.push(`snapshot.${walker}.seq is not an integer`);
    if (!(typeof p?.age_ms === 'number' && p.age_ms >= 0))
      problems.push(`snapshot.${walker}.age_ms is not a non-negative number`);
    if (!Number.isInteger(p?.captured?.year) || !Number.isInteger(p?.captured?.year_tick))
      problems.push(`snapshot.${walker}.captured is not a {year, year_tick} game time`);
  }
  return problems;
}

function rowParity(spec, live, snap) {
  const failures = [];
  const drift = [];
  const liveRows = live[spec.rows] ?? [];
  const snapRows = snap[spec.rows] ?? [];
  if (liveRows.length !== snapRows.length)
    failures.push(`${spec.rows}: ${liveRows.length} live rows vs ${snapRows.length} projected`);
  const shared = Math.min(liveRows.length, snapRows.length);
  for (let i = 0; i < shared; i++) {
    for (const field of spec.identity) {
      if (isDeepStrictEqual(liveRows[i][field], snapRows[i][field])) continue;
      failures.push(
        `${spec.rows}[${i}].${field}: live ${brief(liveRows[i][field])} vs projected ${brief(snapRows[i][field])}`
      );
    }
  }
  const movedFields = new Set();
  let moved = 0;
  for (let i = 0; i < shared; i++) {
    const changed = (spec.volatile ?? []).filter(
      (f) => !isDeepStrictEqual(liveRows[i][f], snapRows[i][f])
    );
    for (const f of changed) movedFields.add(f);
    if (changed.length) moved++;
  }
  if (moved)
    drift.push(
      `${spec.rows}: ${moved}/${shared} rows moved since capture (${[...movedFields].join(', ')})`
    );
  return { failures, drift };
}

/**
 * Compares one tool's live and snapshot payloads under its parity spec.
 * Paused, the two must be deep-equal once provenance is stripped — that is the
 * real assertion. Running, the identity spine must still hold exactly and the
 * fields that legitimately move are reported as drift, not failure.
 * @param spec An entry from PARITY_SPECS.
 * @param liveData The payload from source=live.
 * @param snapData The payload from source=snapshot.
 * @param paused Whether the game was paused for both reads.
 * @returns `{ failures, drift }`, both arrays of human-readable strings.
 */
export function compareParity(spec, liveData, snapData, { paused }) {
  const failures = [
    ...sourceProblems(liveData, 'live').map((p) => `live: ${p}`),
    ...sourceProblems(snapData, 'snapshot').map((p) => `snapshot: ${p}`),
  ];
  const live = stripProvenance(liveData);
  const snap = stripProvenance(snapData);

  if (paused) {
    if (!isDeepStrictEqual(live, snap))
      failures.push(`not deep-equal to the live read
      live:      ${brief(live)}
      projected: ${brief(snap)}`);
    return { failures, drift: [] };
  }

  for (const field of spec.stable ?? []) {
    if (isDeepStrictEqual(live[field], snap[field])) continue;
    failures.push(`${field}: live ${brief(live[field])} vs projected ${brief(snap[field])}`);
  }
  const drift = (spec.drifting ?? []).filter((f) => !isDeepStrictEqual(live[f], snap[f]));
  if (!spec.rows) return { failures, drift };
  const rows = rowParity(spec, live, snap);
  return { failures: [...failures, ...rows.failures], drift: [...drift, ...rows.drift] };
}
