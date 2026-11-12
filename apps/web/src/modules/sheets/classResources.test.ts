import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { registerHooks } from 'node:module';
// Node's renderer has no stylesheet loader; styles are exercised in the browser preview.
registerHooks({ load(url, context, nextLoad) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : nextLoad(url, context); } });
const { ClassResources } = await import('./ClassResources');
import type { Sheet } from './types';

const sheet: Sheet = {
  id: 'resources-test', name: 'Sample hero', playerName: 'Example', level: 1, proficiency: 1,
  classId: 'warlock', subclassId: 'pact-of-the-endless', ancestryId: null, communityId: null,
  traits: { agility: 0, strength: 2, finesse: 1, instinct: 2, presence: 3, knowledge: -1 }, traitMarks: [],
  evasionBonus: 0, armorId: null, armorSlotsMarked: 0, hpMarked: 0, stressMarked: 0, hope: 2,
  bonusHpSlots: 0, bonusStressSlots: 0, experiences: [], weapons: [], inventory: [], gold: 0,
  domainCardIds: [], loadoutIds: [], background: [], connections: [], notes: '',
  subclassUpgraded: 0, multiclassId: null, advancements: [], createdAt: '', updatedAt: '',
};
const render = (changes: Partial<Sheet> = {}) => renderToStaticMarkup(createElement(ClassResources, { sheet: { ...sheet, ...changes }, onUpdate: () => { throw new Error('Rendering must not mutate the sheet'); } }));

test('class resources render editable patron details and default Favor with manual-effects explanation', () => {
  const markup = render({ resources: { classResources: { 'warlock-patron': 'The Lantern', 'warlock-sphere': 'Lost paths' } } });
  assert.match(markup, /Class resources/);
  assert.match(markup, /value="The Lantern"/);
  assert.match(markup, /value="Lost paths"/);
  assert.match(markup, /value="3"/);
  assert.match(markup, /Increase Favor/);
  assert.match(markup, /does not spend Hope or Stress/);
});

test('Martial Artist controls are not offered to a Juggernaut', () => {
  const martial = render({ classId: 'brawler', subclassId: 'martial-artist' });
  assert.match(martial, /Increase Focus/);
  assert.match(martial, /known/);
  const juggernaut = render({ classId: 'brawler', subclassId: 'juggernaut' });
  assert.doesNotMatch(juggernaut, /Increase Focus/);
  assert.doesNotMatch(juggernaut, /known/);
});

test('Prayer Dice display stored faces and individual spending controls', () => {
  const markup = render({ classId: 'seraph', subclassId: 'divine-wielder', resources: { prayerDice: [2, 4], featuresStartedFor: 'session' } });
  assert.match(markup, /Spend .*die 1/);
  assert.match(markup, /Spend .*die 2/);
  assert.match(markup, /value="2" selected=""/);
  assert.match(markup, /value="4" selected=""/);
});

test('multiclass resources render together without exposing unrelated stale state', () => {
  const markup = render({ multiclassId: 'assassin', multiclassSubclassId: 'poisoners-guild', resources: { classResources: { 'assassin-poison': 4, 'witch-hexes': ['Private stale target'] } } });
  assert.match(markup, /Warlock/);
  assert.match(markup, /Assassin/);
  assert.match(markup, /value="4"/);
  assert.doesNotMatch(markup, /Private stale target/);
});
