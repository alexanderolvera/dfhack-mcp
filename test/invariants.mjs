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
        : [
            `happiness sum ${sum} !== population ${p.fort_status.population} (buckets ${JSON.stringify(h)})`,
          ];
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
        if (!(typeof d[k] === 'number' && d[k] >= -1))
          out.push(`${k}=${d[k]} below the -1 sentinel`);
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
          out.push(
            `wells_truncated=${d.wells_truncated} disagrees with wells_total ${d.wells_total} vs listed ${wells.length}`
          );
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
          if (!LEVELS.has(h.supplies[k]))
            out.push(`hospital.supplies.${k}="${h.supplies[k]}" is not a valid level`);
        }
        for (const k of ['splints', 'crutches']) {
          if (!(isInt(h.supplies[k]) && h.supplies[k] >= 0))
            out.push(`hospital.supplies.${k}=${h.supplies[k]} is not a non-negative integer`);
        }
      }
      // A well counted inside the hospital must appear in the fort's well inventory.
      if (h.well_in_hospital === true && Array.isArray(d.wells) && d.wells.length === 0)
        out.push('hospital.well_in_hospital is true but the fort reports zero wells');
      // An all-inclusive temple satisfies every worshipper (documented mechanic).
      const t = d.temples ?? {};
      if (
        t.all_inclusive === true &&
        Array.isArray(t.needed_by_worshippers) &&
        t.needed_by_worshippers.length > 0
      )
        out.push(
          `all-inclusive temple present, yet needed_by_worshippers lists ${t.needed_by_worshippers.length}`
        );
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
      if (!(isInt(g.count) && g.count >= 0))
        out.push(`goods_at_depot.count=${g.count} not a non-negative integer`);
      if (!(typeof g.approx_value === 'number' && g.approx_value >= 0))
        out.push(`goods_at_depot.approx_value=${g.approx_value} is negative`);
      const KNOWN = new Set(['None', 'Approaching', 'AtDepot', 'Leaving', 'Stuck']);
      if (!Array.isArray(d.caravans)) return [...out, 'caravans is not an array'];
      let atDepot = 0;
      d.caravans.forEach((c, i) => {
        if (!KNOWN.has(c.state))
          out.push(`caravans[${i}].state="${c.state}" is not a known trade_state`);
        if (c.state === 'AtDepot') atDepot += 1;
      });
      // A caravan can only be AtDepot if a depot exists to dock at.
      if (atDepot > 0 && !d.depot?.exists)
        out.push(`${atDepot} caravan(s) AtDepot but depot.exists is false`);
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
        if (!MOODS.has(m?.mood))
          out.push(`active[${i}].mood="${m?.mood}" is not a strange-mood type`);
        if (!STATUS.has(m?.workshop_status))
          out.push(`active[${i}].workshop_status="${m?.workshop_status}" is unknown`);
        if (!isInt(m?.mood_timeout))
          out.push(`active[${i}].mood_timeout=${m?.mood_timeout} is not an integer`);
        if (!Array.isArray(m?.demands)) {
          out.push(`active[${i}].demands is not an array`);
          return;
        }
        m.demands.forEach((dem, j) => {
          if (!(isInt(dem?.needed) && dem.needed >= 0))
            out.push(
              `active[${i}].demands[${j}].needed=${dem?.needed} is not a non-negative integer`
            );
          if (!(isInt(dem?.gathered) && dem.gathered >= 0))
            out.push(
              `active[${i}].demands[${j}].gathered=${dem?.gathered} is not a non-negative integer`
            );
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
        if (!(isInt(c.x) && inRange(c.x, 0, e.x - 1)))
          out.push(`fort_core.x=${c.x} outside [0, ${e.x})`);
        if (!(isInt(c.y) && inRange(c.y, 0, e.y - 1)))
          out.push(`fort_core.y=${c.y} outside [0, ${e.y})`);
        if (!zOk(c.z)) out.push(`fort_core.z=${c.z} outside [0, ${zc})`);
      }
      // surface_z is null or a real z-level.
      if (d.surface_z !== null && !zOk(d.surface_z))
        out.push(`surface_z=${d.surface_z} outside [0, ${zc})`);
      // every activity z-level is a real z-level, and the union covers both parts.
      const a = d.activity ?? {};
      const uni = new Set(a.z_levels ?? []);
      for (const key of ['z_levels', 'construction_z', 'digging_z']) {
        for (const z of a[key] ?? []) {
          if (!zOk(z)) out.push(`activity.${key} contains z=${z} outside [0, ${zc})`);
          if (key !== 'z_levels' && !uni.has(z))
            out.push(`activity.${key} z=${z} missing from the z_levels union`);
        }
      }
      // stair columns: a downward-consistent vertical run inside the map.
      const cols = d.stair_columns;
      if (!Array.isArray(cols)) {
        out.push('stair_columns is not an array');
      } else {
        cols.forEach((s, i) => {
          if (!(isInt(s.x) && inRange(s.x, 0, e.x - 1)))
            out.push(`stair_columns[${i}].x=${s.x} outside [0, ${e.x})`);
          if (!(isInt(s.y) && inRange(s.y, 0, e.y - 1)))
            out.push(`stair_columns[${i}].y=${s.y} outside [0, ${e.y})`);
          if (!zOk(s.z_top)) out.push(`stair_columns[${i}].z_top=${s.z_top} outside [0, ${zc})`);
          if (!zOk(s.z_bottom))
            out.push(`stair_columns[${i}].z_bottom=${s.z_bottom} outside [0, ${zc})`);
          if (isInt(s.z_top) && isInt(s.z_bottom) && s.z_top < s.z_bottom)
            out.push(`stair_columns[${i}] z_top=${s.z_top} < z_bottom=${s.z_bottom}`);
        });
        if (cols.length > 40) out.push(`stair_columns length ${cols.length} exceeds the cap of 40`);
        const shouldTrunc = isInt(d.stair_columns_total) && d.stair_columns_total > cols.length;
        if (Boolean(d.stair_columns_truncated) !== shouldTrunc)
          out.push(
            `stair_columns_truncated=${d.stair_columns_truncated} disagrees with total ${d.stair_columns_total} vs listed ${cols.length}`
          );
      }
      return out;
    },
  },
  {
    name: 'environment_wellformed',
    tools: ['environment'],
    // OUTPUT WELL-FORMEDNESS only. The fog-of-war guarantee (every listed cavern is
    // one the fort actually breached) is enforced in Lua against DF's Discovered flag
    // and can't be independently re-derived cheaply here — so this spec asserts SHAPE,
    // not provenance: known enums, a coherent temperature triple, and a bounded caverns
    // list of in-range layer numbers. A leaked-but-shape-valid layer would pass; that's
    // the Lua guard's job, not this one's.
    desc: 'season/weather/temperature/biome are in their known sets with a coherent temperature triple, and caverns is a bounded, well-formed list of layer numbers in 1..3 (output shape, not fog-of-war provenance)',
    check(p) {
      const d = p.environment;
      const out = [];
      // Season is 0..3; season_name is one of the four.
      if (!inRange(d.season, 0, 3)) out.push(`season=${d.season} outside 0..3`);
      const SEASONS = new Set(['spring', 'summer', 'autumn', 'winter']);
      if (!SEASONS.has(d.season_name))
        out.push(`season_name="${d.season_name}" is not a known season`);
      // Surface: weather / band from fixed enums; the temperature triple is coherent.
      const s = d.surface ?? {};
      if (!new Set(['none', 'rain', 'snow']).has(s.weather))
        out.push(`surface.weather="${s.weather}" unknown`);
      if (!new Set(['freezing', 'above_freezing', 'unknown']).has(s.temperature_band))
        out.push(`surface.temperature_band="${s.temperature_band}" unknown`);
      // Unknown temperature (no surface sample) must be honest all the way through:
      // temperature null, water_frozen null, band 'unknown' — never a fabricated false.
      const tempKnown = typeof s.temperature === 'number';
      if (!(tempKnown || s.temperature === null))
        out.push(`surface.temperature=${s.temperature} is neither a number nor null`);
      if (!tempKnown) {
        if (s.water_frozen !== null)
          out.push(`temperature unknown but water_frozen=${s.water_frozen} is not null`);
        if (s.temperature_band !== 'unknown')
          out.push(`temperature unknown but band="${s.temperature_band}" is not 'unknown'`);
      } else {
        if (typeof s.water_frozen !== 'boolean')
          out.push(`surface.water_frozen=${s.water_frozen} not boolean with a known temperature`);
        if (s.water_frozen !== s.temperature <= 10000)
          out.push(
            `water_frozen=${s.water_frozen} disagrees with temperature ${s.temperature} vs freeze point 10000`
          );
        // band and water_frozen are the same fact stated two ways — they must not conflict.
        if (s.temperature_band === 'freezing' && s.water_frozen !== true)
          out.push('temperature_band=freezing but water_frozen is not true');
        if (s.temperature_band === 'above_freezing' && s.water_frozen !== false)
          out.push('temperature_band=above_freezing but water_frozen is not false');
      }
      // Biome alignment is three booleans (the embark-known flags).
      const b = d.biome ?? {};
      for (const k of ['evil', 'good', 'reanimating']) {
        if (typeof b[k] !== 'boolean') out.push(`biome.${k}=${b[k]} not boolean`);
      }
      // Caverns: a bounded list; each entry is a layer numbered 1..3 with an
      // open_to_fort boolean, no duplicates, and the count agrees with the list.
      const c = d.caverns;
      if (!Array.isArray(c)) return [...out, 'caverns is not an array'];
      if (c.length > 3) out.push(`caverns list length ${c.length} exceeds the 3 possible layers`);
      const nums = new Set();
      c.forEach((cv, i) => {
        if (!(isInt(cv?.cavern) && inRange(cv.cavern, 1, 3)))
          out.push(`caverns[${i}].cavern=${cv?.cavern} is not a layer number in 1..3`);
        if (typeof cv?.open_to_fort !== 'boolean')
          out.push(`caverns[${i}].open_to_fort=${cv?.open_to_fort} not boolean`);
        if (nums.has(cv?.cavern)) out.push(`caverns[${i}].cavern=${cv?.cavern} is duplicated`);
        nums.add(cv?.cavern);
      });
      if (d.caverns_discovered !== c.length)
        out.push(`caverns_discovered=${d.caverns_discovered} disagrees with listed ${c.length}`);
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
        if (!(isInt(j[k]) && j[k] >= 0))
          out.push(`justice.${k}=${j[k]} is not a non-negative integer`);
      }
      // A prison sentence / scheduled beating is itself a pending punishment, so
      // it can never exceed the total; a free restraint can't exceed those built.
      if (!inRange(j.prison_sentences, 0, j.pending_punishments))
        out.push(
          `prison_sentences=${j.prison_sentences} exceeds pending_punishments=${j.pending_punishments}`
        );
      if (!inRange(j.scheduled_beatings, 0, j.pending_punishments))
        out.push(
          `scheduled_beatings=${j.scheduled_beatings} exceeds pending_punishments=${j.pending_punishments}`
        );
      if (!inRange(j.restraints_free, 0, j.restraints_built))
        out.push(
          `restraints_free=${j.restraints_free} outside [0, restraints_built=${j.restraints_built}]`
        );
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
  {
    name: 'tile_region_grid_wellformed',
    tools: ['tile_region'],
    desc: 'the grid matches its declared size, honors the 100x100 cap, its legend is a bijection with the glyphs actually used, fog-of-war tiles are never painted over, and the sparse liquids list agrees with the grid',
    check(p) {
      const d = p.tile_region;
      const out = [];
      const size = d.size;
      if (!Array.isArray(size) || !isInt(size[0]) || !isInt(size[1]))
        return ['size is not a [w,h] integer pair'];
      const [w, h] = size;
      // Hard cap (AC): neither side may exceed 100, and a window is at least 1x1.
      if (!inRange(w, 1, 100) || !inRange(h, 1, 100))
        out.push(`size ${w}x${h} outside the 1..100 cap`);
      if (!Array.isArray(d.grid)) return [...out, 'grid is not an array'];
      // Row count == declared height; every row's length == declared width.
      if (d.grid.length !== h) out.push(`grid has ${d.grid.length} rows but height is ${h}`);
      let qcount = 0;
      d.grid.forEach((row, i) => {
        if (typeof row !== 'string') {
          out.push(`grid[${i}] is not a string`);
          return;
        }
        if (row.length !== w) out.push(`grid[${i}] length ${row.length} !== width ${w}`);
        for (const ch of row) if (ch === '?') qcount++;
      });
      // Self-describing, BOTH directions: the legend is built dynamically from the
      // glyphs present, so "exactly the glyphs used" is the real contract. Every
      // used glyph must have a legend entry AND every legend key must be a glyph
      // that actually appears — a stale legend key (or a missing one) is a bug.
      const legend = d.legend ?? {};
      const used = new Set(d.grid.join(''));
      for (const g of used)
        if (!(g in legend)) out.push(`glyph "${g}" appears in grid but is missing from legend`);
      for (const k of Object.keys(legend))
        if (!used.has(k)) out.push(`legend key "${k}" is not used anywhere in the grid`);
      // Fog-of-war honest: the count of '?' in the grid must equal the reported
      // hidden-tile count. An overlay that painted a class/liquid glyph over a
      // hidden tile would drop the '?' count below hidden_tiles — this catches it.
      if (isInt(d.hidden_tiles) && qcount !== d.hidden_tiles)
        out.push(
          `grid shows ${qcount} '?' tiles but hidden_tiles=${d.hidden_tiles} (fog overwritten?)`
        );
      // truncated must carry the original requested size; an untruncated window
      // must not (the flag and the echo agree).
      if (d.truncated === true && !Array.isArray(d.requested))
        out.push('truncated is true but requested [w,h] is absent');
      if (d.truncated === false && d.requested !== undefined)
        out.push('truncated is false yet requested is present');
      // The sparse liquid-depth list: every entry is inside the window, carries a
      // valid type + flow_size 1..7, and — crucially — the grid cell at its
      // coordinate shows the matching glyph (so the list never claims liquid on a
      // hidden '?' tile, and never disagrees with what the grid renders).
      const [ox, oy] = Array.isArray(d.origin) ? d.origin : [NaN, NaN];
      if (!Array.isArray(d.liquids)) {
        out.push('liquids is not an array');
      } else {
        for (const [i, q] of d.liquids.entries()) {
          if (q.type !== 'water' && q.type !== 'magma')
            out.push(`liquids[${i}].type="${q.type}" is not water/magma`);
          if (!(isInt(q.depth) && inRange(q.depth, 1, 7)))
            out.push(`liquids[${i}].depth=${q.depth} outside flow_size 1..7`);
          if (!(
            isInt(q.x) &&
            inRange(q.x, ox, ox + w - 1) &&
            isInt(q.y) &&
            inRange(q.y, oy, oy + h - 1)
          )) {
            out.push(`liquids[${i}] (${q.x},${q.y}) is outside the window`);
            continue;
          }
          const cell = d.grid[q.y - oy]?.[q.x - ox];
          const want = q.type === 'magma' ? '%' : '~';
          if (cell !== want)
            out.push(`liquids[${i}] (${q.x},${q.y}) is "${cell}" in the grid, expected "${want}"`);
        }
      }
      return out;
    },
  },
  {
    name: 'geology_depths_ordered_and_fog_honest',
    tools: ['geology'],
    desc: 'every layer/aquifer/cavern z_top >= z_bottom, aquifer.type is light|heavy when present, and the default payload leaks no undiscovered-depth keys',
    check(p) {
      const d = p.geology;
      const out = [];
      // surface_z is an integer z-level.
      if (!isInt(d.surface_z)) out.push(`surface_z=${d.surface_z} is not an integer`);
      // Every geological band is ordered top-at-or-above-bottom with real materials.
      if (!Array.isArray(d.layers)) {
        out.push('layers is not an array');
      } else {
        d.layers.forEach((b, i) => {
          if (!(isInt(b.z_top) && isInt(b.z_bottom) && b.z_top >= b.z_bottom))
            out.push(`layers[${i}] z_top=${b.z_top} < z_bottom=${b.z_bottom}`);
          if (!Array.isArray(b.materials) || b.materials.some((m) => typeof m !== 'string' || !m))
            out.push(`layers[${i}].materials is not a list of non-empty strings`);
        });
      }
      // Aquifer: a present aquifer is light|heavy with an ordered z-range; an absent
      // one carries no z-range tell.
      const aq = d.aquifer ?? {};
      if (aq.present) {
        if (aq.type !== 'light' && aq.type !== 'heavy')
          out.push(`aquifer.type="${aq.type}" is not light|heavy`);
        if (!(isInt(aq.z_top) && isInt(aq.z_bottom) && aq.z_top >= aq.z_bottom))
          out.push(`aquifer z_top=${aq.z_top} < z_bottom=${aq.z_bottom}`);
      } else if (aq.type !== undefined || aq.z_top !== undefined || aq.z_bottom !== undefined) {
        out.push('aquifer.present is false but a type/z-range leaked');
      }
      // Discovered caverns: ordered z-range, positive layer number, boolean water.
      if (!Array.isArray(d.caverns_discovered)) {
        out.push('caverns_discovered is not an array');
      } else {
        d.caverns_discovered.forEach((c, i) => {
          if (!(isInt(c.z_top) && isInt(c.z_bottom) && c.z_top >= c.z_bottom))
            out.push(`caverns_discovered[${i}] z_top=${c.z_top} < z_bottom=${c.z_bottom}`);
          if (!(isInt(c.layer) && c.layer >= 1))
            out.push(`caverns_discovered[${i}].layer=${c.layer} is not >= 1`);
          if (typeof c.water !== 'boolean')
            out.push(`caverns_discovered[${i}].water=${c.water} is not a boolean`);
        });
      }
      if (typeof d.magma_reached !== 'boolean')
        out.push(`magma_reached=${d.magma_reached} is not a boolean`);
      // FOG OF WAR: with reveal_hidden NOT passed (the harness calls geology with no
      // args), the fog-piercing keys must be entirely ABSENT — no undiscovered
      // cavern/magma z-range may leak into the default survey.
      for (const k of ['reveal_hidden', 'caverns_hidden', 'magma_hidden']) {
        if (k in d) out.push(`default payload leaks fog-of-war key "${k}"`);
      }
      // Surface water counts are sane.
      const sw = d.surface_water ?? {};
      if (!(isInt(sw.murky_pools) && sw.murky_pools >= 0))
        out.push(`surface_water.murky_pools=${sw.murky_pools} is not a non-negative integer`);
      for (const k of ['brook', 'river', 'permanent_freeze']) {
        if (typeof sw[k] !== 'boolean') out.push(`surface_water.${k}=${sw[k]} is not a boolean`);
      }
      return out;
    },
  },
  {
    name: 'work_order_list_wellformed',
    tools: ['work_order_list'],
    desc: 'each order has a valid id/frequency/status, amount_left in [0, amount_total], the (default) page accounts for the fort total, and next_cursor appears iff truncated',
    check(p) {
      const out = [];
      const d = p.work_order_list;
      if (!isInt(d.count) || d.count < 0)
        out.push(`count=${d.count} is not a non-negative integer`);
      if (typeof d.manager_present !== 'boolean')
        out.push(`manager_present=${d.manager_present} is not a boolean`);
      if (typeof d.truncated !== 'boolean') out.push(`truncated=${d.truncated} is not a boolean`);
      if (!Array.isArray(d.orders)) {
        out.push('orders is not an array');
        return out;
      }
      // The invariant runs against the DEFAULT (no-cursor) call, so the page starts
      // at the first order: when NOT truncated it holds every order.
      if (d.truncated === false && d.orders.length !== d.count)
        out.push(`untruncated but orders.length=${d.orders.length} != count=${d.count}`);
      if (d.truncated === true && d.orders.length >= d.count)
        out.push(`truncated but orders.length=${d.orders.length} >= count=${d.count}`);
      // next_cursor is present exactly when truncated, and is the last listed id.
      if (d.truncated === true && d.next_cursor !== d.orders[d.orders.length - 1]?.id)
        out.push(`truncated but next_cursor=${d.next_cursor} != last listed id`);
      if (d.truncated === false && d.next_cursor !== undefined)
        out.push(`not truncated but next_cursor=${d.next_cursor} leaked`);
      const FREQ = ['OneTime', 'Daily', 'Monthly', 'Seasonally', 'Yearly'];
      let lastId = -Infinity;
      for (const o of d.orders) {
        if (!isInt(o.id) || o.id < 0) out.push(`order id=${o.id} is not a non-negative integer`);
        if (o.id < lastId) out.push(`orders not sorted by id (${o.id} after ${lastId})`);
        lastId = o.id;
        if (typeof o.job_type !== 'string' || !o.job_type)
          out.push(`order ${o.id} job_type is not a non-empty string`);
        if (!FREQ.includes(o.frequency))
          out.push(`order ${o.id} frequency="${o.frequency}" invalid`);
        if (!(isInt(o.amount_total) && o.amount_total >= 1))
          out.push(`order ${o.id} amount_total=${o.amount_total} is not >= 1`);
        if (!inRange(o.amount_left, 0, o.amount_total))
          out.push(`order ${o.id} amount_left=${o.amount_left} not in [0, ${o.amount_total}]`);
        if (!(isInt(o.conditions) && o.conditions >= 0))
          out.push(`order ${o.id} conditions=${o.conditions} is not a non-negative integer`);
        if (typeof o.active !== 'boolean')
          out.push(`order ${o.id} active=${o.active} is not a boolean`);
        if (typeof o.validated !== 'boolean')
          out.push(`order ${o.id} validated=${o.validated} is not a boolean`);
      }
      return out;
    },
  },
  {
    name: 'blueprint_apply_preview_wellformed',
    tools: ['blueprint_apply'],
    desc: 'the dry-run preview is a well-formed §A0 envelope: applied:false, a coherent facts preview (dig|zone mode, integer 3-tuple anchor, non-negative tile/fog/pre-existing/clipped counts, bounded structured conflicts), and either a single-use confirm_token OR a blocked reason list with NO token',
    check(p) {
      const d = p.blueprint_apply;
      const out = [];
      // The harness calls the actuator WITHOUT a confirm_token, so this is always a
      // preview envelope from src/actuator.ts — never an apply.
      if (d.mode !== 'preview') out.push(`mode="${d.mode}" is not the preview envelope`);
      if (d.applied !== false) out.push(`applied=${d.applied} is not false for a dry-run`);
      const pv = d.preview ?? {};
      if (pv.mode !== 'dig' && pv.mode !== 'zone')
        out.push(`preview.mode="${pv.mode}" is not dig|zone`);
      const anc = pv.anchor;
      if (!Array.isArray(anc) || anc.length !== 3 || anc.some((n) => !isInt(n)))
        out.push(`preview.anchor=${JSON.stringify(anc)} is not an integer [x,y,z]`);
      for (const k of [
        'tiles_affected',
        'invalid_key_sequences',
        'could_not_designate',
        'footprint_cells',
        'fog_of_war_tiles',
        'pre_existing_designations',
        'clipped_out_of_bounds',
      ]) {
        if (!(isInt(pv[k]) && pv[k] >= 0))
          out.push(`preview.${k}=${pv[k]} is not a non-negative integer`);
      }
      // Per-footprint counts can never exceed the footprint they are scanned over.
      for (const k of ['fog_of_war_tiles', 'pre_existing_designations', 'clipped_out_of_bounds']) {
        if (isInt(pv[k]) && isInt(pv.footprint_cells) && pv[k] > pv.footprint_cells)
          out.push(`${k}=${pv[k]} exceeds footprint_cells=${pv.footprint_cells}`);
      }
      // conflicts is optional-when-empty: a BOUNDED structured list of
      // {x:int, y:int, reason: non-empty string}; parse_errors likewise a bounded
      // list of non-empty diagnostic lines. Truncation flags are true-or-absent.
      if (pv.conflicts !== undefined) {
        if (!Array.isArray(pv.conflicts) || pv.conflicts.length === 0 || pv.conflicts.length > 50)
          out.push(
            `conflicts is not a non-empty list of <= 50 entries (len=${pv.conflicts?.length})`
          );
        else
          for (const c of pv.conflicts)
            if (!isInt(c?.x) || !isInt(c?.y) || typeof c?.reason !== 'string' || !c.reason.trim())
              out.push(`conflict ${JSON.stringify(c)} is not {x:int, y:int, reason:string}`);
      }
      if (pv.conflicts_truncated !== undefined && pv.conflicts_truncated !== true)
        out.push(`conflicts_truncated=${pv.conflicts_truncated} is present but not true`);
      if (pv.parse_errors !== undefined) {
        if (
          !Array.isArray(pv.parse_errors) ||
          pv.parse_errors.length === 0 ||
          pv.parse_errors.length > 20 ||
          pv.parse_errors.some((s) => typeof s !== 'string' || !s.trim())
        )
          out.push('parse_errors is present but not a non-empty list of <= 20 non-empty strings');
      }
      // Token discipline (§A0): a clean preview mints a single-use confirm_token and
      // reports no block; a blocked preview reports reasons and mints NO token.
      const hasToken = typeof d.confirm_token === 'string' && d.confirm_token.length > 0;
      const blocked = d.blocked;
      if (blocked !== undefined) {
        if (!Array.isArray(blocked) || blocked.some((s) => typeof s !== 'string' || !s.trim()))
          out.push('blocked is present but not a list of non-empty reason strings');
        if (hasToken) out.push('a blocked preview must NOT mint a confirm_token');
      } else if (!hasToken) {
        out.push('an unblocked preview must mint a confirm_token');
      }
      return out;
    },
  },
  {
    name: 'work_details_wellformed',
    tools: ['work_details'],
    desc: 'each detail has a non-empty name, a known mode, string labor tokens, ascending integer members agreeing with member_count + the 200 cap/truncation flag (cursor-aware), members_cursor present iff truncated, and parallel member_names',
    check(p) {
      const out = [];
      const d = p.work_details;
      // The members_after cursor echo: absent on a plain call, an integer when the
      // caller paged. The member-list relations below depend on which mode this is.
      const after = d.members_after;
      if (after !== undefined && !isInt(after))
        out.push(`members_after=${after} is not an integer`);
      if (!isInt(d.count) || d.count < 0)
        out.push(`count=${d.count} is not a non-negative integer`);
      if (!Array.isArray(d.details)) return [...out, 'details is not an array'];
      if (d.details.length !== d.count)
        out.push(`details.length=${d.details.length} != count=${d.count}`);
      const MODES = new Set([
        'Default',
        'EverybodyDoesThis',
        'NobodyDoesThis',
        'OnlySelectedDoesThis',
      ]);
      const CAP = 200;
      d.details.forEach((wd, i) => {
        if (typeof wd.name !== 'string' || !wd.name)
          out.push(`details[${i}].name is not a non-empty string`);
        if (!MODES.has(wd.mode)) out.push(`details[${i}].mode="${wd.mode}" is not a known mode`);
        if (typeof wd.no_modify !== 'boolean')
          out.push(`details[${i}].no_modify=${wd.no_modify} is not a boolean`);
        if (
          !Array.isArray(wd.allowed_labors) ||
          wd.allowed_labors.some((l) => typeof l !== 'string' || !l)
        )
          out.push(`details[${i}].allowed_labors is not a list of non-empty strings`);
        if (!(isInt(wd.member_count) && wd.member_count >= 0))
          out.push(`details[${i}].member_count=${wd.member_count} is not a non-negative integer`);
        if (typeof wd.members_truncated !== 'boolean')
          out.push(`details[${i}].members_truncated=${wd.members_truncated} is not a boolean`);
        if (!Array.isArray(wd.members)) {
          out.push(`details[${i}].members is not an array`);
          return;
        }
        if (wd.members.some((m) => !isInt(m)))
          out.push(`details[${i}].members has a non-integer id`);
        if (wd.members.length > CAP)
          out.push(`details[${i}].members length ${wd.members.length} exceeds cap ${CAP}`);
        // members is strictly ascending (id-sorted, no duplicates) …
        for (let j = 1; j < wd.members.length; j++) {
          if (!(wd.members[j] > wd.members[j - 1])) {
            out.push(`details[${i}].members is not strictly ascending at index ${j}`);
            break;
          }
        }
        // … and, when a cursor was passed, starts strictly after it.
        if (isInt(after) && wd.members.length && wd.members[0] <= after)
          out.push(
            `details[${i}].members starts at ${wd.members[0]} despite members_after=${after}`
          );
        // members_cursor appears exactly when truncated, and is the last listed id.
        if (wd.members_truncated) {
          if (wd.members_cursor !== wd.members[wd.members.length - 1])
            out.push(`details[${i}].members_cursor=${wd.members_cursor} != last listed id`);
        } else if (wd.members_cursor !== undefined) {
          out.push(
            `details[${i}].members_cursor=${wd.members_cursor} leaked on an untruncated list`
          );
        }
        if (after === undefined) {
          // No cursor: members holds the FULL list unless truncated; flag agrees with the cap.
          const shouldTrunc = isInt(wd.member_count) && wd.member_count > wd.members.length;
          if (Boolean(wd.members_truncated) !== shouldTrunc)
            out.push(
              `details[${i}].members_truncated disagrees with member_count ${wd.member_count} vs listed ${wd.members.length}`
            );
          if (
            !wd.members_truncated &&
            isInt(wd.member_count) &&
            wd.member_count !== wd.members.length
          )
            out.push(
              `details[${i}] untruncated member_count ${wd.member_count} != listed ${wd.members.length}`
            );
        } else if (isInt(wd.member_count) && wd.members.length > wd.member_count) {
          // Cursor page: a tail can be any length, but never MORE than the full count.
          out.push(
            `details[${i}] pages ${wd.members.length} members, more than member_count ${wd.member_count}`
          );
        }
        if (!Array.isArray(wd.member_names) || wd.member_names.length !== wd.members.length)
          out.push(`details[${i}].member_names is not parallel to members`);
      });
      return out;
    },
  },
];
