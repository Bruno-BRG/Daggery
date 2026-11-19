import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { dualityTable, IRON_MOVE_GROUPS, IRON_MOVES, LODESTAR_MOVE_NAMES, lodestarTable } from '@daggery/shared';
import { LODESTAR_GROUPS, lodestarTablesIn } from './lodestar-reference';
import { MOVE_FLOWS, MOVE_GROUP_META, OUTCOME_ORDER } from './workflow';

test('every move has a flow, and every flow belongs to a move', () => {
  const ids = new Set(IRON_MOVES.map(move => move.id));
  for (const move of IRON_MOVES) assert.ok(MOVE_FLOWS[move.id], `no flow for ${move.id}`);
  for (const id of Object.keys(MOVE_FLOWS)) assert.ok(ids.has(id), `flow for unknown move ${id}`);
});

test('every table a move points at exists, in the d12 or the d100 catalog', () => {
  for (const [id, flow] of Object.entries(MOVE_FLOWS)) {
    for (const step of [...(flow.tools ?? []), ...OUTCOME_ORDER.flatMap(outcome => flow[outcome] ?? [])]) {
      if (step.kind === 'table') assert.doesNotThrow(() => dualityTable(step.table), `${id}: ${step.table}`);
      if (step.kind === 'lodestar') assert.doesNotThrow(() => lodestarTable(step.table), `${id}: ${step.table}`);
    }
  }
});

test('moves that roll progress or action say so, and progress moves are the Ironsworn progress moves', () => {
  const progress = Object.entries(MOVE_FLOWS).filter(([, flow]) => flow.resolve === 'progress').map(([id]) => IRON_MOVES.find(move => move.id === id)!.name).sort();
  assert.deepEqual(progress, ['End the Fight', 'Finish the Scene', 'Fulfill Your Vow', 'Reach Your Destination', 'Write Your Epilogue'].sort());
});

test('every move group has an icon and a blurb', () => {
  for (const group of IRON_MOVE_GROUPS) assert.ok(MOVE_GROUP_META[group.id]?.blurb, group.id);
});

test('the panel prints every Ironsworn d100 table once', () => {
  const printed = LODESTAR_GROUPS.flatMap(group => lodestarTablesIn(group.id).map(table => table.id));
  assert.equal(new Set(printed).size, printed.length);
  assert.ok(printed.includes('pay-the-price') && printed.includes('challenge-rank'));
});

test('the Lodestar list is the full 35 moves', () => {
  assert.equal(LODESTAR_MOVE_NAMES.length, 35);
});
