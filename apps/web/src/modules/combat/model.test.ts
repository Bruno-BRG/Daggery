import assert from 'node:assert/strict';
import test from 'node:test';
import { computeBudget, hordeDamage, hpForDamage, minionDefeats, type AdversaryFeature } from './model';

const thresholds = { major: 8, severe: 16 };

test('damage maps to 1/2/3 HP at the printed thresholds', () => {
  assert.deepEqual(hpForDamage(0, thresholds), { marks: 0, severity: null });
  assert.deepEqual(hpForDamage(7, thresholds), { marks: 1, severity: 'Minor' });
  assert.deepEqual(hpForDamage(8, thresholds), { marks: 2, severity: 'Major' });
  assert.deepEqual(hpForDamage(15, thresholds), { marks: 2, severity: 'Major' });
  assert.deepEqual(hpForDamage(16, thresholds), { marks: 3, severity: 'Severe' });
});

test('a Horde uses its Horde (X) damage once half its HP (rounded up) is marked', () => {
  const features: AdversaryFeature[] = [{ name: 'Horde (1d4+2)', kind: 'Passive', text: '' }];
  assert.equal(hordeDamage(features, 2, 5, '1d10+2'), '1d10+2');
  assert.equal(hordeDamage(features, 3, 5, '1d10+2'), '1d4+2');
  assert.equal(hordeDamage(features, 0, 6, '1d10+2'), '1d10+2');
  assert.equal(hordeDamage(features, 3, 6, '1d10+2'), '1d4+2');
});

test('Minion (X) defeats the target plus one per X damage', () => {
  const features: AdversaryFeature[] = [{ name: 'Minion (3)', kind: 'Passive', text: '' }];
  assert.equal(minionDefeats(0, features), 0);
  assert.equal(minionDefeats(2, features), 1);
  assert.equal(minionDefeats(3, features), 2);
  assert.equal(minionDefeats(6, features), 3);
  assert.equal(minionDefeats(7, features), 3);
});

test('Battle Points start at 3 x PCs + 2 with the printed adjustments', () => {
  const flags = { easier: false, plusDamage: false, lowerTier: false, dangerous: false };
  assert.equal(computeBudget(3, flags, ['Bruiser']).total, 11);
  assert.equal(computeBudget(5, flags, ['Minion']).total, 18);
  assert.equal(computeBudget(3, flags, ['Solo', 'Solo']).total, 9);
  assert.equal(computeBudget(3, { ...flags, easier: true, dangerous: true }, []).total, 12);
});
