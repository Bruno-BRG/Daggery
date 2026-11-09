import assert from 'node:assert/strict';
import test from 'node:test';
import { classes, domainCards } from '@daggery/content';
import { presentAbility } from './abilityPresentation';

test('Bone defenses show their specific trigger, cost and formula without inventing rounding rules', () => {
  const reaction = domainCards.find(card => card.id === 'i-see-it-coming')!;
  const passive = domainCards.find(card => card.id === 'untouchable')!;
  const view = presentAbility(reaction.name, reaction.text);
  assert.deepEqual(view.facts.map(fact => fact.value), ['1 Stress', 'Beyond Melee']);
  assert.equal(view.metric?.value, '+1d4');
  assert.equal(presentAbility(passive.name, passive.text).metric?.value, '+½ Agility');
  assert.doesNotMatch(JSON.stringify(presentAbility(passive.name, passive.text)), /round|floor|ceil/i);
});

test('Ranger Focus keeps success as the trigger and distinguishes marking Stress from ending Focus to reroll', () => {
  const ranger = classes.find(entry => entry.id === 'ranger')!;
  const focus = ranger.classFeatures.find(feature => feature.name === "Ranger's Focus")!;
  const view = presentAbility("Ranger’s Focus", focus.text);
  assert.match(view.summary, /On a success/);
  assert.equal(view.facts[0]?.value, '1 Hope');
  assert.match(view.benefits?.[1]?.text ?? '', /they mark a Stress/);
  assert.match(view.benefits?.[2]?.text ?? '', /End Focus to reroll your Duality Dice/);
  assert.doesNotMatch(JSON.stringify(view), /until.*scene/i);
});

test('Hope costs are extracted only from an explicit leading cost, never from an optional clause later in a feature', () => {
  const view = presentAbility('Hope: Example', 'Spend 3 Hope to clear 2 Stress.');
  assert.equal(view.summary, 'Clear 2 Stress.');
  assert.equal(view.facts[0]?.value, '3 Hope');
  const conditional = presentAbility('Example reaction', 'When an ally is hit, you can mark a Stress to help them.');
  assert.deepEqual(conditional.facts, []);
});

test('unknown long rules get a bounded preview while the original source string stays intact', () => {
  const source = `${'An unfamiliar effect has additional conditions '.repeat(12)}and resolves at the end of the scene.`;
  const view = presentAbility('Custom future feature', source);
  assert.ok(view.summary.length <= 210);
  assert.ok(view.summary.endsWith('…'));
  assert.ok(source.endsWith('and resolves at the end of the scene.'));
});
