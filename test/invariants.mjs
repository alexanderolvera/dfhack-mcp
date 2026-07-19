// Relational invariants — properties true of ANY valid loaded fort, not just one
// frozen fixture. This is the Red/Green half of the harness: goldens freeze the
// EXACT bytes a tool emits ("did anything change?"), invariants encode INTENDED
// CORRECTNESS ("is the output self-consistent and true?"). So you can add a new
// invariant that FAILS against today's code (red), then fix the tool until it
// PASSES (green) — a spec you write before the behaviour exists, not a snapshot
// of behaviour that already does.
//
// Each invariant is:
//   { name, tools: string[], desc, check(payloads) => string[] }
//     tools  — the tool payloads it reads; the runner captures these live and
//              skips the invariant as n/a if any is absent or returned the
//              no-fort guard (so `--invariants` degrades cleanly with no fort).
//     check  — returns an array of violation messages; an empty array is a PASS.
//
// Invariants are RELATIONAL, so they hold on any fort and need no committed
// fixture — they are the tier that runs live today, ahead of shareable goldens.

const isInt = (n) => typeof n === 'number' && Number.isInteger(n);
const inRange = (n, lo, hi) => typeof n === 'number' && n >= lo && n <= hi;

export const INVARIANTS = [
  {
    name: 'population_consistency',
    tools: ['fort_status', 'injuries_and_health', 'stocks'],
    desc: 'every tool that counts citizens agrees (all derive from getCitizens(true))',
    check(p) {
      const pops = {
        fort_status: p.fort_status.population,
        injuries_and_health: p.injuries_and_health.population,
        stocks: p.stocks.population,
      };
      const distinct = [...new Set(Object.values(pops))];
      return distinct.length === 1
        ? []
        : [`population disagrees across tools: ${JSON.stringify(pops)}`];
    },
  },
  {
    name: 'happiness_partitions_population',
    tools: ['fort_status'],
    desc: 'the four happiness buckets sum to exactly the population',
    check(p) {
      const h = p.fort_status.happiness ?? {};
      const sum = (h.miserable || 0) + (h.unhappy || 0) + (h.content || 0) + (h.happy || 0);
      return sum === p.fort_status.population
        ? []
        : [`happiness sum ${sum} !== population ${p.fort_status.population} (buckets ${JSON.stringify(h)})`];
    },
  },
  {
    name: 'health_counts_within_population',
    tools: ['injuries_and_health'],
    desc: 'no medical bucket exceeds the population or goes negative',
    check(p) {
      const d = p.injuries_and_health;
      const out = [];
      for (const k of ['wounded', 'patients', 'bedridden', 'unconscious']) {
        if (!inRange(d[k], 0, d.population)) out.push(`${k}=${d[k]} outside [0, ${d.population}]`);
      }
      return out;
    },
  },
  {
    name: 'stocks_nonnegative',
    tools: ['stocks'],
    desc: 'raw counts are >= 0 and days-of-supply is >= 0 or the -1 no-population sentinel',
    check(p) {
      const d = p.stocks;
      const out = [];
      for (const [k, v] of Object.entries(d.counts ?? {})) {
        if (!(typeof v === 'number' && v >= 0)) out.push(`counts.${k}=${v} is negative`);
      }
      for (const k of ['food_days', 'drink_days']) {
        if (!(typeof d[k] === 'number' && d[k] >= -1)) out.push(`${k}=${d[k]} below the -1 sentinel`);
      }
      return out;
    },
  },
  {
    name: 'stocks_notable_keys_known',
    tools: ['stocks'],
    desc: 'notable_low / notable_high name real stock categories, never a typo',
    check(p) {
      const d = p.stocks;
      const known = new Set([...Object.keys(d.counts ?? {}), 'food', 'drink']);
      const out = [];
      for (const k of [...(d.notable_low ?? []), ...(d.notable_high ?? [])]) {
        if (!known.has(k)) out.push(`notable entry "${k}" is not a known stock key`);
      }
      return out;
    },
  },
  {
    name: 'find_unit_matches_carry_ids',
    tools: ['find_unit'],
    desc: 'every match exposes an integer unit_id (the documented chain into citizen/identify)',
    check(p) {
      const d = p.find_unit;
      if (!Array.isArray(d.matches)) return ['matches is not an array'];
      const out = [];
      d.matches.forEach((m, i) => {
        if (!isInt(m?.unit_id)) out.push(`matches[${i}].unit_id=${m?.unit_id} is not an integer`);
      });
      return out;
    },
  },
  {
    name: 'citizen_resolves_requested_unit',
    tools: ['find_unit', 'citizen'],
    desc: 'citizen(find_unit.matches[0].unit_id) returns THAT unit — the real tool-to-tool chain',
    check(p) {
      const want = p.find_unit.matches?.[0]?.unit_id;
      // No id to chain from (find_unit_matches_carry_ids owns that failure); nothing to assert here.
      if (!isInt(want)) return [];
      return p.citizen.unit_id === want
        ? []
        : [`citizen returned unit_id ${p.citizen.unit_id}, expected ${want} (chain broken)`];
    },
  },
  {
    name: 'rooms_counts_nonnegative_and_well_cap',
    tools: ['rooms_and_zones'],
    desc: 'every facility/demand count is a non-negative integer and the wells list honors its cap + truncation flag',
    check(p) {
      const d = p.rooms_and_zones;
      const out = [];
      const nn = {
        'bedrooms.assigned': d.bedrooms?.assigned,
        'bedrooms.unassigned': d.bedrooms?.unassigned,
        'bedrooms.adults_without': d.bedrooms?.adults_without,
        'bedrooms.dormitories': d.bedrooms?.dormitories,
        'dining.halls': d.dining?.halls,
        'dining.seats': d.dining?.seats,
        taverns: d.taverns,
        libraries: d.libraries,
        guildhalls: d.guildhalls,
        coffins_free: d.coffins_free,
        coffins_used: d.coffins_used,
        dead_unburied: d.dead_unburied,
        wells_total: d.wells_total,
      };
      for (const [k, v] of Object.entries(nn)) {
        if (!(isInt(v) && v >= 0)) out.push(`${k}=${v} is not a non-negative integer`);
      }
      const wells = d.wells;
      if (!Array.isArray(wells)) {
        out.push('wells is not an array');
      } else {
        if (wells.length > 20) out.push(`wells list length ${wells.length} exceeds the cap of 20`);
        // wells_truncated must agree with whether the full total exceeds what's listed.
        const shouldTrunc = isInt(d.wells_total) && d.wells_total > wells.length;
        if (Boolean(d.wells_truncated) !== shouldTrunc)
          out.push(`wells_truncated=${d.wells_truncated} disagrees with wells_total ${d.wells_total} vs listed ${wells.length}`);
        if (!d.wells_truncated && isInt(d.wells_total) && d.wells_total !== wells.length)
          out.push(`untruncated wells_total ${d.wells_total} !== listed ${wells.length}`);
      }
      return out;
    },
  },
  {
    name: 'rooms_hospital_and_worship_coherent',
    tools: ['rooms_and_zones'],
    desc: 'hospital supply levels are valid, a well-in-hospital implies a well exists, and an all-inclusive temple leaves no worshipper needing one',
    check(p) {
      const d = p.rooms_and_zones;
      const out = [];
      const h = d.hospital ?? {};
      if (h.zoned && h.supplies) {
        const LEVELS = new Set(['none', 'low', 'ok']);
        for (const k of ['thread', 'cloth']) {
          if (!LEVELS.has(h.supplies[k])) out.push(`hospital.supplies.${k}="${h.supplies[k]}" is not a valid level`);
        }
        for (const k of ['splints', 'crutches']) {
          if (!(isInt(h.supplies[k]) && h.supplies[k] >= 0)) out.push(`hospital.supplies.${k}=${h.supplies[k]} is not a non-negative integer`);
        }
      }
      // A well counted inside the hospital must appear in the fort's well inventory.
      if (h.well_in_hospital === true && Array.isArray(d.wells) && d.wells.length === 0)
        out.push('hospital.well_in_hospital is true but the fort reports zero wells');
      // An all-inclusive temple satisfies every worshipper (documented mechanic).
      const t = d.temples ?? {};
      if (t.all_inclusive === true && Array.isArray(t.needed_by_worshippers) && t.needed_by_worshippers.length > 0)
        out.push(`all-inclusive temple present, yet needed_by_worshippers lists ${t.needed_by_worshippers.length}`);
      return out;
    },
  },
  {
    name: 'trade_state_consistency',
    tools: ['trade'],
    desc: 'depot goods are non-negative, caravan states are known, and no caravan is "at depot" without a depot to be at',
    check(p) {
      const d = p.trade;
      const out = [];
      const g = d.goods_at_depot ?? {};
      if (!(isInt(g.count) && g.count >= 0)) out.push(`goods_at_depot.count=${g.count} not a non-negative integer`);
      if (!(typeof g.approx_value === 'number' && g.approx_value >= 0))
        out.push(`goods_at_depot.approx_value=${g.approx_value} is negative`);
      const KNOWN = new Set(['None', 'Approaching', 'AtDepot', 'Leaving', 'Stuck']);
      if (!Array.isArray(d.caravans)) return [...out, 'caravans is not an array'];
      let atDepot = 0;
      d.caravans.forEach((c, i) => {
        if (!KNOWN.has(c.state)) out.push(`caravans[${i}].state="${c.state}" is not a known trade_state`);
        if (c.state === 'AtDepot') atDepot += 1;
      });
      // A caravan can only be AtDepot if a depot exists to dock at.
      if (atDepot > 0 && !d.depot?.exists) out.push(`${atDepot} caravan(s) AtDepot but depot.exists is false`);
      return out;
    },
  },
  {
    name: 'moods_wellformed',
    tools: ['moods'],
    desc: 'each active strange mood has an integer unit_id, a known mood/status, and demands whose counts are sane (needed/gathered >= 0, have >= -1 sentinel)',
    check(p) {
      const d = p.moods;
      if (!Array.isArray(d.active)) return ['active is not an array'];
      const MOODS = new Set(['fey', 'secretive', 'possessed', 'macabre', 'fell']);
      const STATUS = new Set(['unclaimed', 'gathering', 'working']);
      const out = [];
      d.active.forEach((m, i) => {
        if (!isInt(m?.unit_id)) out.push(`active[${i}].unit_id=${m?.unit_id} is not an integer`);
        if (!MOODS.has(m?.mood)) out.push(`active[${i}].mood="${m?.mood}" is not a strange-mood type`);
        if (!STATUS.has(m?.workshop_status))
          out.push(`active[${i}].workshop_status="${m?.workshop_status}" is unknown`);
        if (!isInt(m?.mood_timeout)) out.push(`active[${i}].mood_timeout=${m?.mood_timeout} is not an integer`);
        if (!Array.isArray(m?.demands)) {
          out.push(`active[${i}].demands is not an array`);
          return;
        }
        m.demands.forEach((dem, j) => {
          if (!(isInt(dem?.needed) && dem.needed >= 0))
            out.push(`active[${i}].demands[${j}].needed=${dem?.needed} is not a non-negative integer`);
          if (!(isInt(dem?.gathered) && dem.gathered >= 0))
            out.push(`active[${i}].demands[${j}].gathered=${dem?.gathered} is not a non-negative integer`);
          if (!(isInt(dem?.have) && dem.have >= -1))
            out.push(`active[${i}].demands[${j}].have=${dem?.have} is below the -1 sentinel`);
        });
      });
      return out;
    },
  },
  {
    name: 'alerts_are_nonempty_strings',
    tools: ['fort_status', 'injuries_and_health'],
    desc: 'alerts, when present, are human-readable non-empty strings',
    check(p) {
      const out = [];
      for (const t of ['fort_status', 'injuries_and_health']) {
        const a = p[t].alerts;
        if (a === undefined) continue;
        if (!Array.isArray(a)) {
          out.push(`${t}.alerts is not an array`);
          continue;
        }
        a.forEach((s, i) => {
          if (typeof s !== 'string' || !s.trim())
            out.push(`${t}.alerts[${i}] is not a non-empty string`);
        });
      }
      return out;
    },
  },
  {
    name: 'map_overview_extents_and_activity_coherent',
    tools: ['map_overview'],
    desc: 'extents are positive, every activity/surface/stair z sits inside [0, z_count), each stair column runs top>=bottom, and the columns list honors its cap + truncation flag',
    check(p) {
      const d = p.map_overview;
      const out = [];
      const e = d.extents ?? {};
      for (const k of ['x', 'y', 'z']) {
        if (!(isInt(e[k]) && e[k] > 0)) out.push(`extents.${k}=${e[k]} is not a positive integer`);
      }
      const zc = e.z; // valid z-levels are [0, zc)
      const zOk = (z) => isInt(z) && inRange(z, 0, zc - 1);
      // fort_core, when present, sits inside the map.
      const c = d.fort_core;
      if (c !== null && c !== undefined) {
        if (!(isInt(c.x) && inRange(c.x, 0, e.x - 1))) out.push(`fort_core.x=${c.x} outside [0, ${e.x})`);
        if (!(isInt(c.y) && inRange(c.y, 0, e.y - 1))) out.push(`fort_core.y=${c.y} outside [0, ${e.y})`);
        if (!zOk(c.z)) out.push(`fort_core.z=${c.z} outside [0, ${zc})`);
      }
      // surface_z is null or a real z-level.
      if (d.surface_z !== null && !zOk(d.surface_z)) out.push(`surface_z=${d.surface_z} outside [0, ${zc})`);
      // every activity z-level is a real z-level, and the union covers both parts.
      const a = d.activity ?? {};
      const uni = new Set(a.z_levels ?? []);
      for (const key of ['z_levels', 'construction_z', 'digging_z']) {
        for (const z of a[key] ?? []) {
          if (!zOk(z)) out.push(`activity.${key} contains z=${z} outside [0, ${zc})`);
          if (key !== 'z_levels' && !uni.has(z)) out.push(`activity.${key} z=${z} missing from the z_levels union`);
        }
      }
      // stair columns: a downward-consistent vertical run inside the map.
      const cols = d.stair_columns;
      if (!Array.isArray(cols)) {
        out.push('stair_columns is not an array');
      } else {
        cols.forEach((s, i) => {
          if (!(isInt(s.x) && inRange(s.x, 0, e.x - 1))) out.push(`stair_columns[${i}].x=${s.x} outside [0, ${e.x})`);
          if (!(isInt(s.y) && inRange(s.y, 0, e.y - 1))) out.push(`stair_columns[${i}].y=${s.y} outside [0, ${e.y})`);
          if (!zOk(s.z_top)) out.push(`stair_columns[${i}].z_top=${s.z_top} outside [0, ${zc})`);
          if (!zOk(s.z_bottom)) out.push(`stair_columns[${i}].z_bottom=${s.z_bottom} outside [0, ${zc})`);
          if (isInt(s.z_top) && isInt(s.z_bottom) && s.z_top < s.z_bottom)
            out.push(`stair_columns[${i}] z_top=${s.z_top} < z_bottom=${s.z_bottom}`);
        });
        if (cols.length > 40) out.push(`stair_columns length ${cols.length} exceeds the cap of 40`);
        const shouldTrunc = isInt(d.stair_columns_total) && d.stair_columns_total > cols.length;
        if (Boolean(d.stair_columns_truncated) !== shouldTrunc)
          out.push(`stair_columns_truncated=${d.stair_columns_truncated} disagrees with total ${d.stair_columns_total} vs listed ${cols.length}`);
      }
      return out;
    },
  },
  {
    name: 'justice_counts_self_consistent',
    tools: ['mandates_and_justice'],
    desc: 'justice sub-counts are non-negative and bounded by their supersets, and mandate/demand rows are well-formed',
    check(p) {
      const d = p.mandates_and_justice;
      const j = d.justice ?? {};
      const out = [];
      // Every justice tally is a non-negative integer.
      for (const k of [
        'open_cases',
        'pending_punishments',
        'prison_sentences',
        'scheduled_beatings',
        'scheduled_hammerstrikes',
        'restraints_built',
        'restraints_free',
      ]) {
        if (!(isInt(j[k]) && j[k] >= 0)) out.push(`justice.${k}=${j[k]} is not a non-negative integer`);
      }
      // A prison sentence / scheduled beating is itself a pending punishment, so
      // it can never exceed the total; a free restraint can't exceed those built.
      if (!inRange(j.prison_sentences, 0, j.pending_punishments))
        out.push(`prison_sentences=${j.prison_sentences} exceeds pending_punishments=${j.pending_punishments}`);
      if (!inRange(j.scheduled_beatings, 0, j.pending_punishments))
        out.push(`scheduled_beatings=${j.scheduled_beatings} exceeds pending_punishments=${j.pending_punishments}`);
      if (!inRange(j.restraints_free, 0, j.restraints_built))
        out.push(`restraints_free=${j.restraints_free} outside [0, restraints_built=${j.restraints_built}]`);
      // Mandate rows: remaining is between zero and the total quota.
      (d.mandates ?? []).forEach((m, i) => {
        if (!inRange(m.remaining, 0, m.count))
          out.push(`mandates[${i}].remaining=${m.remaining} outside [0, count=${m.count}]`);
      });
      // Every listed demand is an UNMET one (met === false), by construction.
      (d.demands ?? []).forEach((dm, i) => {
        if (dm.met !== false) out.push(`demands[${i}].met=${dm.met} is not false`);
      });
      return out;
    },
  },
];
