import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_TOOLS } from '../src/tools/registry.ts';
import { normalizeAssignApply } from '../src/tools/workDetail.ts';

const ID_OR_CURSOR = /(^|_)ids?$|_after$|^since$/;

const PENDING_WORK_ORDERS = new Set([
  'work_order_list.after_id',
  'work_order_create.amount',
  'work_order_cancel.order_id',
]);

function unwrap(schema) {
  let s = schema;
  while (['optional', 'nullable', 'default'].includes(s._zod.def.type)) s = s._zod.def.innerType;
  if (s._zod.def.type === 'array') return { leaf: s._zod.def.element, isArray: true };
  return { leaf: s, isArray: false };
}

const params = ALL_TOOLS.flatMap((tool) =>
  Object.entries(tool.shape ?? {}).map(([key, schema]) => ({
    path: `${tool.name}.${key}`,
    key,
    schema,
    ...unwrap(schema),
  }))
);

test('every id/cursor parameter is numeric, not a digit string', () => {
  const offenders = params
    .filter((p) => ID_OR_CURSOR.test(p.key) && p.leaf._zod.def.type !== 'number')
    .map((p) => `${p.path} (${p.leaf._zod.def.type})`);
  assert.deepEqual(offenders, [], `id/cursor params must be z.coerce.number().int(): ${offenders}`);
});

test('every numeric parameter accepts its string encoding (z.coerce.number().int())', () => {
  const offenders = [];
  for (const p of params) {
    if (p.leaf._zod.def.type !== 'number' || PENDING_WORK_ORDERS.has(p.path)) continue;
    const input = p.isArray ? ['1'] : '1';
    const want = p.isArray ? [1] : 1;
    const r = p.schema.safeParse(input);
    if (!r.success || JSON.stringify(r.data) !== JSON.stringify(want)) offenders.push(p.path);
  }
  assert.deepEqual(offenders, [], `numeric params that reject a string: ${offenders}`);
});

test('numeric parameters still reject non-integers', () => {
  const offenders = params
    .filter((p) => p.leaf._zod.def.type === 'number')
    .filter((p) => p.schema.safeParse(p.isArray ? ['1.5'] : '1.5').success)
    .map((p) => p.path);
  assert.deepEqual(offenders, [], `numeric params that accept 1.5: ${offenders}`);
});

test('citizen.unit_id keeps its non-negative constraint', () => {
  const unitId = ALL_TOOLS.find((t) => t.name === 'citizen').shape.unit_id;
  assert.equal(unitId.safeParse('42').data, 42);
  assert.equal(unitId.safeParse(42).data, 42);
  assert.equal(unitId.safeParse('-1').success, false);
  assert.equal(unitId.safeParse('abc').success, false);
});

test('assign_work_detail apply: empty labor maps come back as objects, not arrays', () => {
  const r = normalizeAssignApply({
    changes: { unit_id: 1 },
    undo: { unit_id: 1, prior_labors: [] },
    readback: { unit_id: 1, unit_labors_now: [] },
  });
  assert.deepEqual(r.undo.prior_labors, {});
  assert.deepEqual(r.readback.unit_labors_now, {});
});

test('assign_work_detail apply: populated labor maps pass through untouched', () => {
  const r = normalizeAssignApply({
    changes: {},
    undo: { prior_labors: { MINE: false } },
    readback: { unit_labors_now: { MINE: true } },
  });
  assert.deepEqual(r.undo.prior_labors, { MINE: false });
  assert.deepEqual(r.readback.unit_labors_now, { MINE: true });
});
