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
];
