/** Exhaustive math check for the legacy Hope & Fear oracle kept for older campaigns. Does not read or write campaign data. */
import assert from 'node:assert/strict';
import { resolveDuality } from '../packages/shared/src/dice';

const likelihoods = [
  ['Very likely', 8, 126], ['Likely', 11, 104], ['Even', 14, 72],
  ['Unlikely', 17, 44], ['Very unlikely', 20, 24],
] as const;
const pairs = Array.from({ length: 12 }, (_, h) =>
  Array.from({ length: 12 }, (_, f) => resolveDuality(h + 1, f + 1))).flat();
assert.equal(pairs.length, 144);
assert.equal(pairs.filter(p => p.critical).length, 12);

const report = likelihoods.map(([label, target, expectedYes]) => {
  const yes = pairs.filter(p => p.critical || p.total >= target);
  assert.equal(yes.length, expectedYes, `${label}: wrong affirmative count`);
  assert.equal(yes.filter(p => !p.critical && p.withHope).length,
    yes.filter(p => p.withFear).length, `${label}: tone favors one die`);
  assert.equal(yes.filter(p => p.critical).length, 12);
  return { likelihood: label, target, affirmativePairs: yes.length,
    totalPairs: pairs.length, percentYes: Number((yes.length / 144 * 100).toFixed(1)) };
});

const scene = { expected: 0, opportunity: 0, obstacle: 0, twist: 0 };
for (const pair of pairs) {
  if (pair.critical) scene.twist++;
  else if (pair.hope - pair.fear >= 6) scene.opportunity++;
  else if (pair.fear - pair.hope >= 6) scene.obstacle++;
  else scene.expected++;
}
assert.deepEqual(scene, { expected: 90, opportunity: 21, obstacle: 21, twist: 12 });
assert.equal(Object.values(scene).reduce((sum, count) => sum + count, 0), 144);
console.log(JSON.stringify({ oracle: report, scenePairs: scene, verified: true }, null, 2));
