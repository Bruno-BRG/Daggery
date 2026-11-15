import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { SOLO_RULES_VERSION } from '@daggery/shared';
import { act, completion, currentTurn, fixture, runTurn, summaryReply } from './ai-test-kit';

/** The fake model never calls tools; tests run the oracle directly against the open turn. */
const handler = (request: { tools: boolean }) => request.tools ? completion('The world waits. What do you do?') : summaryReply();
const fearOf = (f: Awaited<ReturnType<typeof fixture>>) => f.ai.actions.read<{ value: number }>(f.campaign, 'combat', 'fear')?.value;

test('consult_oracle works in a group campaign, shows an Oracle roll message, and never spends Fear', async () => {
  const f = await fixture(handler);
  try {
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    // At 12 Fear a scene Fear Check always passes, so the engine would normally spend 1.
    f.ai.actions.write(f.campaign, 'combat', 'fear', { kind: 'fear', value: 12 });
    const scene = act(f, turn, 'consult_oracle', { kind: 'scene' }) as Record<string, any>;
    assert.equal(scene.kind, 'duality-scene');
    assert.match(scene.detail, /Suggested Fear cost: 1 \(Fear pool 12\)\. Pay it with spend_fear only if you use this move\./);
    assert.doesNotMatch(scene.detail, /Fear spent:/);
    assert.equal(fearOf(f), 12, 'the Fear pool is never written by the oracle');
    const message = f.ai.session(f.user.id, f.campaign).messages.filter(entry => entry.role === 'roll').at(-1)!;
    assert.ok(message.text.startsWith('Oracle · '), 'the consult is visible as an oracle message');
    assert.ok(message.text.includes(scene.title) && message.text.includes('Suggested Fear cost: 1 (Fear pool 12).'), 'the dice and result are in the transcript');
    assert.doesNotMatch(message.text, /spend_fear/, 'the players never see tool names');

    const before = f.ai.session(f.user.id, f.campaign).messages.length;
    const secret = act(f, turn, 'consult_oracle', { kind: 'plot', hidden: true }) as Record<string, any>;
    assert.equal(secret.kind, 'duality-plot');
    assert.equal(f.ai.session(f.user.id, f.campaign).messages.length, before, 'a hidden consult writes no transcript message');

    assert.throws(() => act(f, turn, 'consult_oracle', { kind: 'yes-no', likelihood: 'even' }), /Invalid question/);
    assert.throws(() => act(f, turn, 'consult_oracle', { kind: 'nope' }), /Invalid oracle kind/);
    assert.throws(() => act(f, turn, 'consult_oracle', { kind: 'yes-no', question: 'Is it open?', likelihood: 'certain' }), /Invalid likelihood/);
  } finally {
    await f.close();
  }
});

test('consult_oracle fills the Threads list from the AI campaign state when the tracker is empty', async () => {
  const f = await fixture(handler);
  try {
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    act(f, turn, 'update_state', { threads: [{ title: 'Find the vanished keeper', status: 'open', note: 'The harbor holds the clue.' }] });
    const picked = act(f, turn, 'consult_oracle', { kind: 'list', list: 'threads' }) as Record<string, any>;
    assert.equal(picked.kind, 'duality-list');
    assert.equal(picked.title, 'Find the vanished keeper');
    assert.match(picked.detail, /Threads d12 \d+: Find the vanished keeper/);
  } finally {
    await f.close();
  }
});

test('consult_oracle records and publishes a solo journal entry in a solo campaign', async () => {
  const f = await fixture(handler);
  try {
    f.campaigns.updateCampaign(f.user.id, f.campaign, 'AI adventure', '', false, { systemId: 'daggerheart', rulesetId: 'solo', gmController: 'ai' });
    await runTurn(f, 'Begin.');
    const turn = currentTurn(f);
    const published: { ns: string; id: string; value: unknown }[] = [];
    const result = f.ai.actions.execute('consult_oracle', { kind: 'npc' }, {
      campaign: f.campaign, owner: f.user.id, turn, callId: 'oracle-direct',
      assertActive: () => {}, publish: (_campaign, ns, id, value) => published.push({ ns, id, value }), publishRoll: () => {},
    }) as Record<string, any>;
    assert.equal(result.kind, 'duality-npc');
    const entries = (f.db.prepare("SELECT value FROM campaign_docs WHERE campaign_id = ? AND ns = 'solo' AND id LIKE 'entry:%'").all(f.campaign) as { value: string }[]).map(row => JSON.parse(row.value) as Record<string, any>);
    const entry = entries.find(item => item.kind === 'duality-npc');
    assert.ok(entry, 'the solo journal received the consult');
    assert.equal(entry!.accepted, false);
    assert.equal(entry!.interpretation, '');
    assert.equal(entry!.rulesVersion, SOLO_RULES_VERSION);
    assert.ok(published.some(doc => doc.ns === 'solo' && doc.id === 'entry:' + entry!.id), 'the entry is published to the Solo log');
  } finally {
    await f.close();
  }
});
