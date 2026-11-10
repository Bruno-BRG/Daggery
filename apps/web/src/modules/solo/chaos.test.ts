import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { clampChaos, CHAOS_DEFAULT, shiftOddsRows, type OddsRow } from './chaos';

// Invented rows, ordered Certain at the top down to Impossible, like the chart.
const rows: OddsRow[] = [
  { id: 'a', label: 'Alpha', ranges: { yes: [1, 40], no: [41, 60] } },
  { id: 'b', label: 'Beta', ranges: { yes: [1, 30], no: [31, 60] } },
  { id: 'c', label: 'Gamma', ranges: { yes: [1, 20], no: [21, 60] } },
  { id: 'd', label: 'Delta', ranges: { yes: [1, 10], no: [11, 60] } },
];

test('chaos 5 leaves the chart exactly as printed', () => {
  const shifted = shiftOddsRows(rows, CHAOS_DEFAULT);
  assert.deepEqual(shifted.map(row => row.ranges), rows.map(row => row.ranges));
  assert.deepEqual(shifted.map(row => row.label), rows.map(row => row.label));
});

test('higher chaos shifts every row toward Certain and clamps at the top', () => {
  const shifted = shiftOddsRows(rows, 7);
  assert.deepEqual(shifted.map(row => row.ranges), [rows[0]!.ranges, rows[0]!.ranges, rows[0]!.ranges, rows[1]!.ranges]);
  // Labels stay in place even though the ranges moved.
  assert.deepEqual(shifted.map(row => row.label), ['Alpha', 'Beta', 'Gamma', 'Delta']);
  assert.equal(shifted[3]!.id, 'd');
});

test('lower chaos shifts every row toward Impossible and clamps at the bottom', () => {
  const shifted = shiftOddsRows(rows, 3);
  assert.deepEqual(shifted.map(row => row.ranges), [rows[2]!.ranges, rows[3]!.ranges, rows[3]!.ranges, rows[3]!.ranges]);
});

test('one step each way moves exactly one row', () => {
  assert.deepEqual(shiftOddsRows(rows, 6).map(row => row.ranges), [rows[0]!.ranges, rows[0]!.ranges, rows[1]!.ranges, rows[2]!.ranges]);
  assert.deepEqual(shiftOddsRows(rows, 4).map(row => row.ranges), [rows[1]!.ranges, rows[2]!.ranges, rows[3]!.ranges, rows[3]!.ranges]);
});

test('chaos is clamped to 1-9 and non-finite values fall back to the printed chart', () => {
  assert.equal(clampChaos(0), 1);
  assert.equal(clampChaos(99), 9);
  assert.equal(clampChaos(Number.NaN), CHAOS_DEFAULT);
  assert.deepEqual(shiftOddsRows(rows, 9).map(row => row.ranges), rows.map(() => rows[0]!.ranges));
  assert.deepEqual(shiftOddsRows(rows, 1).map(row => row.ranges), rows.map(() => rows[3]!.ranges));
});

test('the original rows are not mutated and rows without ranges are safe', () => {
  const before = JSON.stringify(rows);
  shiftOddsRows(rows, 8);
  assert.equal(JSON.stringify(rows), before);

  const sparse: OddsRow[] = [{ label: 'No ranges' }, { label: 'Also none' }];
  assert.deepEqual(shiftOddsRows(sparse, 9).map(row => row.label), ['No ranges', 'Also none']);
});
