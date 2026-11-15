import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { diceModeFor, diceModeKey, setDiceMode, type DiceModeStore } from './diceMode';

function memoryStore(): DiceModeStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

test('the dice mode is remembered per campaign and defaults to digital', () => {
  const store = memoryStore();
  assert.equal(diceModeKey('campaign-a'), 'daggery:dice-mode:campaign-a');
  assert.equal(diceModeFor('campaign-a', store), 'digital', 'nothing saved means digital');
  setDiceMode('campaign-a', 'physical', store);
  assert.equal(diceModeFor('campaign-a', store), 'physical');
  assert.equal(store.values.get('daggery:dice-mode:campaign-a'), 'physical');
  assert.equal(diceModeFor('campaign-b', store), 'digital', 'another campaign keeps its own mode');
});

test('a missing or failing store never breaks play', () => {
  assert.equal(diceModeFor('campaign-a', null), 'digital');
  const broken: DiceModeStore = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(diceModeFor('campaign-a', broken), 'digital');
  assert.doesNotThrow(() => setDiceMode('campaign-a', 'physical', broken));
});
