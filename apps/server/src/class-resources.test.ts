import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { classResourceValue } from '@daggery/shared/daggerheart';
import type { ClassResourceValue, Sheet } from '@daggery/shared/daggerheart/types';
import { quickHero } from './ai/daggerheart';
import { AiService } from './ai/service';
import { act, completion, currentTurn, finished, fixture, summaryReply, type Fixture } from './ai-test-kit';

/** The fixture hero's stored sheet. */
function heroOf(f: Fixture): Sheet {
  const sheet = f.ai.actions.read<Sheet>(f.campaign, 'sheets', f.setup.heroId);
  if (!sheet) throw new Error('the fixture hero is missing');
  return sheet;
}

/** Rewrites the hero sheet (used to pin a class and its tracked resources). */
function heroSheet(f: Fixture, patch: Partial<Sheet>): Sheet {
  const sheet = { ...heroOf(f), ...patch };
  f.ai.actions.write(f.campaign, 'sheets', sheet.id, sheet);
  return sheet;
}

/** Writes the fixture's class-resource trackers through the saved Sheet document. */
function setClassResources(f: Fixture, values: Record<string, ClassResourceValue>): Sheet {
  const sheet = heroOf(f);
  return heroSheet(f, { resources: { ...sheet.resources, classResources: values } });
}

/** The stored class-resource record. */
function classResourcesOf(sheet: Sheet): Record<string, ClassResourceValue> {
  return sheet.resources?.classResources ?? {};
}

test('opening a session resets session class resources once; pause, refresh and resume do not; ending keeps persistent values', async () => {
  const f = await fixture(request => request.tools ? completion('The rallying cry fades. What do you do?') : summaryReply());
  try {
    const { ai, user, campaign } = f;
    // A Warlock/Bard: Rally is a session tracker, while Favor, the patron and Brawler stances are
    // persistent values that every lifecycle event must leave alone.
    heroSheet(f, { classId: 'warlock', subclassId: null, multiclassId: 'bard', multiclassSubclassId: null });
    setClassResources(f, { 'bard-rally-used': true, 'warlock-favor': 3, 'warlock-patron': 'The Hollow', 'brawler-stances': ['power-strike'] });
    const chat = ai.createChat(user.id, campaign, { title: 'Bard session' }).chat.id;
    ai.begin(user.id, campaign, { chatId: chat });
    await finished(ai, user.id, campaign);

    const started = heroOf(f);
    assert.equal(classResourceValue(started, 'bard-rally-used'), false, 'the first Begin resets the session tracker');
    assert.equal(started.resources?.featuresStartedFor, chat, 'the sheet records which chat opened the session');
    assert.equal(classResourceValue(started, 'warlock-favor'), 3, 'persistent Favor is untouched');
    assert.equal(classResourceValue(started, 'warlock-patron'), 'The Hollow', 'the patron is untouched');
    assert.deepEqual(classResourcesOf(started)['brawler-stances'], ['power-strike'], 'persistent stances are untouched');

    const view = act(f, currentTurn(f), 'get_character', { heroId: f.setup.heroId });
    assert.equal(view.resources.classResources['bard-rally-used'], false, 'get_character exposes the current class-resource value');
    assert.equal(view.resources.classResources['warlock-favor'], 3);

    // Reopening the transcript and a refused second Begin never reset (or reroll) again.
    ai.session(user.id, campaign, chat);
    assert.equal(classResourceValue(heroOf(f), 'bard-rally-used'), false);
    assert.throws(() => ai.begin(user.id, campaign, { chatId: chat }), /already begun/);
    assert.equal(heroOf(f).resources?.featuresStartedFor, chat);

    // Use the tracker during play: pause and resume must preserve it rather than resetting.
    setClassResources(f, { 'bard-rally-used': true, 'warlock-favor': 3, 'warlock-patron': 'The Hollow', 'brawler-stances': ['power-strike'] });
    ai.pauseChat(user.id, campaign, { chatId: chat });
    await finished(ai, user.id, campaign);
    ai.resumeChat(user.id, campaign, { chatId: chat });
    assert.equal(classResourceValue(heroOf(f), 'bard-rally-used'), true, 'pause and resume do not reset the tracker');

    // Ending the session clears the session tracker but never the persistent values.
    ai.endChat(user.id, campaign, { chatId: chat, force: true });
    await finished(ai, user.id, campaign);
    const ended = heroOf(f);
    assert.equal(classResourceValue(ended, 'bard-rally-used'), false, 'ending the session clears the session tracker');
    assert.equal(classResourceValue(ended, 'warlock-favor'), 3, 'ending the session does not touch Favor');
    assert.equal(classResourceValue(ended, 'warlock-patron'), 'The Hollow', 'ending the session does not touch the patron');
    assert.deepEqual(classResourcesOf(ended)['brawler-stances'], ['power-strike'], 'ending the session does not touch known stances');
    assert.equal(ended.resources?.featuresStartedFor, chat, 'the idempotency marker survives ending');
  } finally {
    await f.close();
  }
});

test('the Seraph still rolls Prayer Dice exactly once at Begin and other class resources survive', async () => {
  const f = await fixture(request => request.tools ? completion('The prayer is heard. What do you do?') : summaryReply());
  try {
    const { ai, user, campaign } = f;
    heroSheet(f, { ...quickHero('Ash', 'seraph'), id: f.setup.heroId });
    setClassResources(f, { 'some-persistent-choice': 'kept', 'bard-rally-used': true });
    const chat = ai.createChat(user.id, campaign, { title: 'Seraph session' }).chat.id;
    ai.begin(user.id, campaign, { chatId: chat });
    await finished(ai, user.id, campaign);

    const rolled = heroOf(f);
    assert.equal(rolled.resources?.featuresStartedFor, chat);
    assert.equal(rolled.resources?.prayerDice?.length, 2, 'Strength +2 rolls two d4 Prayer Dice');
    assert.ok(rolled.resources!.prayerDice!.every(die => Number.isInteger(die) && die >= 1 && die <= 4));
    assert.equal(classResourcesOf(rolled)['some-persistent-choice'], 'kept', 'the roll does not clobber class resources');
    const dice = [...rolled.resources!.prayerDice!];

    ai.session(user.id, campaign, chat);
    assert.deepEqual(heroOf(f).resources?.prayerDice, dice, 'refreshing the transcript does not reroll');
  } finally {
    await f.close();
  }
});

test('class resources persist through SQLite and are visible to a fresh service over the same database', async () => {
  const f = await fixture(request => request.tools ? completion('The pact holds. What do you do?') : summaryReply());
  let restarted: AiService | null = null;
  try {
    heroSheet(f, { classId: 'warlock', subclassId: null });
    setClassResources(f, { 'warlock-favor': 4, 'warlock-patron': 'The Hollow', 'bard-rally-used': true });
    restarted = new AiService(f.db, f.campaigns, f.vault, f.provider, () => {}, () => {});
    const sheet = restarted.actions.read<Sheet>(f.campaign, 'sheets', f.setup.heroId);
    assert.ok(sheet);
    assert.equal(classResourceValue(sheet, 'warlock-favor'), 4, 'the new service reads the stored Favor');
    assert.equal(classResourceValue(sheet, 'warlock-patron'), 'The Hollow', 'the patron survives a restart');
    assert.equal(classResourcesOf(sheet)['bard-rally-used'], true, 'unrelated class trackers are kept');
  } finally {
    await restarted?.close();
    await f.close();
  }
});
