import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWLIST, findAllowlisted } from '../src/tools/dfhackCommandAllowlist.ts';
import {
  dfhackCommandRun,
  parseLs,
  parseSeedwatch,
  parseTags,
  seedwatchRestore,
} from '../src/tools/dfhackCommand.ts';

const allowed = (line) => findAllowlisted(line[0], line.slice(1))?.id;

test('allowlist accepts each documented form, matched per subcommand', () => {
  assert.equal(allowed(['seedwatch']), 'seedwatch status');
  assert.equal(allowed(['seedwatch', 'status']), 'seedwatch status');
  assert.equal(allowed(['seedwatch', 'MUSHROOM_HELMET_PLUMP', '50']), 'seedwatch set');
  assert.equal(allowed(['seedwatch', 'all', '0']), 'seedwatch set');
  assert.equal(allowed(['seedwatch', 'clear']), 'seedwatch clear');
  assert.equal(allowed(['enable', 'seedwatch']), 'enable seedwatch');
  assert.equal(allowed(['disable', 'seedwatch']), 'disable seedwatch');
  assert.equal(allowed(['instruments']), 'instruments list');
  assert.equal(allowed(['instruments', 'list']), 'instruments list');
  assert.equal(allowed(['instruments', 'order', 'il']), 'instruments order');
  assert.equal(allowed(['instruments', 'order', 'il', '3']), 'instruments order');
  assert.equal(allowed(['prospect']), 'prospect');
  assert.equal(allowed(['prospect', '-s', 'ores,gems', '--values']), 'prospect');
});

test('allowlist rejects anything outside the reviewed forms', () => {
  const rejected = [
    ['lua', 'print(1)'],
    ['enable', 'autolabor'],
    ['enable', 'seedwatch', 'autolabor'],
    ['seedwatch', 'status', '5'],
    ['seedwatch', 'clear', '5'],
    ['seedwatch', 'PLANT', '-1'],
    ['seedwatch', 'PLANT', '5', 'extra'],
    ['seedwatch', 'bad;id', '5'],
    ['instruments', 'order'],
    ['instruments', 'order', '--all'],
    ['instruments', 'order', 'il', 'many'],
    ['instruments', 'order', 'il', '3', '--quiet'],
    ['prospect', 'all'],
    ['prospect', 'hell'],
    ['prospect', '-s', 'ores', 'all'],
    ['prospect', '--show'],
    ['prospect', '--show', 'everything'],
    ['Seedwatch'],
  ];
  for (const line of rejected) assert.equal(allowed(line), undefined, line.join(' '));
});

test('every allowlist entry carries a one-line note, and mutating entries a tracker', () => {
  const ids = ALLOWLIST.map((e) => e.id);
  assert.deepEqual(ids, [...new Set(ids)], 'duplicate allowlist ids');
  for (const e of ALLOWLIST) {
    assert.ok(e.note.length > 10 && !e.note.includes('\n'), `${e.id}: note`);
    if (e.access === 'mutate') assert.ok(e.tracker, `${e.id}: mutating entry needs a tracker`);
  }
});

test('a non-allowlisted command returns the error fact without reaching DFHack', async () => {
  const r = await dfhackCommandRun({ command: 'lua', args: ['print(1)'] });
  assert.equal(r.error, 'not allowlisted');
  assert.equal(r.command, 'lua');
  assert.deepEqual(r.args, ['print(1)']);
  assert.ok(r.allowlist.some((e) => e.id === 'seedwatch status'));
});

test('parseLs reads wrapped help, long names, and wrapped tag lines', () => {
  const text = [
    'gui/gm-editor        Inspect and edit DF game data.',
    '                      tags: animals, armok, buildings,',
    '                      items, units',
    'instruments          Show how to craft instruments or create work orders for',
    '                      them.',
    '                      tags: fort, inspection, workorders',
    'fix/stuck-instruments',
    '                      Allow bugged instruments to be interacted with again.',
    '',
  ].join('\n');
  assert.deepEqual(parseLs(text), [
    { name: 'gui/gm-editor', help: 'Inspect and edit DF game data.', tags: ['animals', 'armok', 'buildings', 'items', 'units'] },
    { name: 'instruments', help: 'Show how to craft instruments or create work orders for them.', tags: ['fort', 'inspection', 'workorders'] },
    { name: 'fix/stuck-instruments', help: 'Allow bugged instruments to be interacted with again.', tags: [] },
  ]);
  assert.deepEqual(parseLs('No matches.\n'), []);
});

test('parseTags joins wrapped descriptions', () => {
  const text = 'armok                Tools which give the player god-like powers or the ability\n                      to access information.\nauto                 Background tools.\n';
  assert.deepEqual(parseTags(text), [
    { tag: 'armok', description: 'Tools which give the player god-like powers or the ability to access information.' },
    { tag: 'auto', description: 'Background tools.' },
  ]);
});

test('parseSeedwatch and seedwatchRestore round-trip a target change', () => {
  const before = parseSeedwatch(
    'seedwatch is enabled\n\nusable seed counts and current targets:\n    50/30 POD_SWEET\n    29/30 BUSH_QUARRY\n\ntotal usable seeds: 79\n'
  );
  assert.deepEqual(before, {
    enabled: true,
    targets: [
      { plant: 'BUSH_QUARRY', usable: 29, target: 30 },
      { plant: 'POD_SWEET', usable: 50, target: 30 },
    ],
  });
  const after = {
    enabled: false,
    targets: [
      { plant: 'GRAPE', usable: 3, target: 10 },
      { plant: 'POD_SWEET', usable: 50, target: 30 },
    ],
  };
  assert.deepEqual(seedwatchRestore(before, after), [
    { command: 'seedwatch', args: ['BUSH_QUARRY', '30'] },
    { command: 'seedwatch', args: ['GRAPE', '0'] },
    { command: 'enable', args: ['seedwatch'] },
  ]);
  assert.deepEqual(seedwatchRestore(before, before), []);
});
