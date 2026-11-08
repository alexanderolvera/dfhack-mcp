import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  createArgv,
  withConditionLists,
  workOrderCancelDef,
  workOrderCreateDef,
  workOrderListDef,
} from '../src/tools/workOrder.ts';

const schemaOf = (def) => z.object(def.shape);

const LIBRARY_CONDITION = {
  condition: 'AtLeast',
  value: 2,
  item_type: 'TOOL',
  item_subtype: 'ITEM_TOOL_HONEYCOMB',
  flags: ['non_pressed'],
  reaction_product: 'HONEYCOMB_PRESS_MAT',
  tool: 'LIQUID_CONTAINER',
};

test('work_order_create accepts DFHack-orders-shaped item and order conditions', () => {
  const parsed = schemaOf(workOrderCreateDef).parse({
    job_type: 'CustomReaction',
    amount: 1,
    item_conditions: [LIBRARY_CONDITION, { condition: 'AtMost', value: 10, item_type: 'BAR' }],
    order_conditions: [{ order_id: '12', condition: 'Completed' }],
  });
  assert.equal(parsed.item_conditions.length, 2);
  assert.deepEqual(parsed.order_conditions, [{ order_id: 12, condition: 'Completed' }]);
});

test('work_order_create rejects unknown condition keys and comparators instead of dropping them', () => {
  const schema = schemaOf(workOrderCreateDef);
  const base = { job_type: 'BrewDrink', amount: 1 };
  for (const bad of [
    { condition: 'AtLeast', value: 1, reaction_id: 'BREW_DRINK_FROM_PLANT' },
    { condition: 'AtLeast', value: 1, dye_color: 3 },
    { condition: 'Sometimes', value: 1 },
    { condition: 'AtLeast', value: 1.5 },
  ]) {
    assert.equal(
      schema.safeParse({ ...base, item_conditions: [bad] }).success,
      false,
      JSON.stringify(bad)
    );
  }
  assert.equal(
    schema.safeParse({ ...base, order_conditions: [{ order_id: 3, condition: 'Done' }] }).success,
    false
  );
});

test('createArgv puts conditions at fixed positions as JSON, empty when absent', () => {
  const argv = createArgv('plan_create', {
    job_type: 'BrewDrink',
    amount: 3,
    item_conditions: [{ condition: 'AtMost', value: 5, item_type: 'DRINK' }],
    order_conditions: [],
  });
  assert.equal(argv.length, 10);
  assert.deepEqual(argv.slice(0, 7), ['plan_create', 'BrewDrink', '3', '', '', '', '']);
  assert.deepEqual(JSON.parse(argv[7]), [{ condition: 'AtMost', value: 5, item_type: 'DRINK' }]);
  assert.equal(argv[8], '');
  assert.equal(argv[9], '');
});

test('ids and cursors coerce from digit strings', () => {
  assert.equal(schemaOf(workOrderListDef).parse({ after_id: '226' }).after_id, 226);
  assert.equal(schemaOf(workOrderCancelDef).parse({ order_id: '227' }).order_id, 227);
  assert.equal(schemaOf(workOrderListDef).safeParse({ after_id: '2.5' }).success, false);
});

test('withConditionLists defaults omitted or Lua-empty condition lists to []', () => {
  const o = withConditionLists({ id: 1, order_conditions: {} });
  assert.deepEqual(o.item_conditions, []);
  assert.deepEqual(o.order_conditions, []);
  const kept = withConditionLists({ id: 2, item_conditions: [LIBRARY_CONDITION] });
  assert.deepEqual(kept.item_conditions, [LIBRARY_CONDITION]);
  assert.equal(withConditionLists(undefined), undefined);
});

test('work_order_create passes meal_ingredients as an integer in the last argv slot', () => {
  const schema = schemaOf(workOrderCreateDef);
  const parsed = schema.parse({ job_type: 'PrepareMeal', amount: 2, meal_ingredients: 4 });
  const argv = createArgv('apply_create', parsed);
  assert.equal(argv.length, 10);
  assert.equal(argv[4], '');
  assert.equal(argv[9], '4');
  assert.equal(
    schema.safeParse({ job_type: 'PrepareMeal', amount: 1, meal_ingredients: 2.5 }).success,
    false
  );
});
