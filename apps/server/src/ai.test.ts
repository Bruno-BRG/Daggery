import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import { openCampaignDatabase, migrateCampaignDatabase, CURRENT_VERSION } from './campaign-db';
import { CampaignService } from './campaign-service';
import { registerCampaignRoutes } from './campaign-routes';
import { registerAiRoutes } from './ai/routes';
import { SecretVault } from './ai/vault';
import { AiConflict, AiService } from './ai/service';
import { ModelProvider } from './ai/provider';
import { quickHero } from './ai/daggerheart';
import { armorScore, getClass, hpMax } from '@daggery/shared/daggerheart';
import { adversaries } from '@daggery/content';

const catalog = { data: [
  { id: 'test-gm', name: 'Test GM', type: 'chat', capabilities: { tools: { supported: true } }, cost: { text: { input: { price: 1 } } } },
  { id: 'free', type: 'chat', capabilities: { tools: { supported: true } }, cost: { text: { input: { price: 0 } } } },
  { id: 'no-tools', type: 'chat', capabilities: { tools: { supported: false } }, cost: { text: { input: { price: 1 } } } },
] };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const completion = (content: string | null, calls?: { id: string; name: string; args: unknown }[]) => json({ choices: [{ message: { role: 'assistant', content, ...(calls ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })) } : {}) } }], usage: { cost: .001 } });
async function finished(ai: AiService, user: string, campaign: string) {
  for (let n = 0; n < 100; n++) { const state = ai.session(user, campaign); if (state.run?.status !== 'running') { await new Promise(resolve => setTimeout(resolve, 0)); return state; } await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('GM did not finish');
}
async function fixture(handler: (body: any, signal: AbortSignal) => Promise<Response> | Response) {
  const db = openCampaignDatabase(':memory:'), campaigns = new CampaignService(db);
  const user = await campaigns.register('gmtest', 'a strong temporary test password');
  const campaign = campaigns.createCampaign(user.id, 'AI adventure', '', { systemId: 'daggerheart', rulesetId: 'core', gmController: 'ai' });
  const requests: string[] = [];
  const provider = new ModelProvider((async (_url, init) => {
    if (!init?.body) return json(catalog);
    requests.push(String(init.body)); return handler(JSON.parse(String(init.body)), init.signal as AbortSignal);
  }) as typeof fetch);
  const published: string[] = [];
  const ai = new AiService(db, campaigns, new SecretVault(randomBytes(32)), provider, (_c, ns, id) => published.push(`${ns}/${id}`));
  await ai.saveConnection(user.id, { provider: 'opencode', model: 'test-gm', apiKey: 'test-secret-never-in-context' });
  const setup = ai.configure(user.id, campaign, { premise: 'Find the vanished keeper', quickHero: { name: 'Ash', classId: 'warrior' } });
  return { ai, db, campaigns, user, campaign, requests, setup, published, provider, close: async () => { await ai.close(); db.close(); } };
}

test('AI vault authenticates ciphertext to its user and migration preserves existing campaigns', async () => {
  const vault = new SecretVault(randomBytes(32)), encrypted = vault.seal('a-private-provider-key', 'user-a');
  assert.equal(vault.open(encrypted, 'user-a'), 'a-private-provider-key');
  assert.notEqual(encrypted, vault.seal('a-private-provider-key', 'user-a'));
  assert.throws(() => vault.open(encrypted, 'user-b'));
  assert.throws(() => new SecretVault(randomBytes(32)).open(encrypted, 'user-a'));
  const db = openCampaignDatabase(':memory:');
  try {
    db.exec('DROP TABLE ai_actions; DROP TABLE ai_messages; DROP TABLE ai_turns; DROP TABLE campaign_ai; DROP TABLE ai_credentials; PRAGMA user_version=3');
    migrateCampaignDatabase(db); migrateCampaignDatabase(db);
    assert.equal(db.pragma('user_version', { simple: true }), CURRENT_VERSION);
    assert.ok((db.prepare('PRAGMA table_info(ai_turns)').all() as { name: string }[]).some(column => column.name === 'checkpoint'));
  } finally { db.close(); }
});

test('provider excludes client-only/free or non-tool models and redacts failed provider responses', async () => {
  const provider = new ModelProvider((async () => json(catalog)) as typeof fetch);
  assert.deepEqual(await provider.models('opencode'), [{ id: 'test-gm', name: 'Test GM', temperature: false }]);
  const rejected = new ModelProvider((async () => json({ error: 'secret-provider-key' }, 401)) as typeof fetch);
  await assert.rejects(rejected.complete('opencode', 'secret-provider-key', 'test-gm', [], [], new AbortController().signal, 'campaign'), error => error instanceof Error && /rejected this API key/.test(error.message) && !error.message.includes('secret-provider-key'));
});

test('OpenCode Go loads its own catalog and uses subscription routing without a credit fallback', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const provider = new ModelProvider((async (url, init) => { requests.push({ url: String(url), init }); return init?.body ? json({ error: 'upstream private detail' }, 402) : json(catalog); }) as typeof fetch);
  const models = await provider.models('opencode-go');
  assert.deepEqual(models.map(model => model.id), ['free', 'test-gm']);
  assert.equal(requests[0]?.url, 'https://opencode.ai/inference/go/v1/models');
  await assert.rejects(provider.complete('opencode-go', 'private-key', 'test-gm', [], [], new AbortController().signal, 'campaign-session'), /Go could not cover this request/);
  assert.equal(requests.length, 2, 'a subscription failure must never retry on the credit endpoint');
  assert.equal(requests[1]?.url, 'https://opencode.ai/inference/go/openai/v1/chat/completions');
  const headers = requests[1]?.init?.headers as Record<string, string>;
  assert.equal(headers['x-opencode-session'], 'campaign-session'); assert.equal(headers['User-Agent'], 'Daggery-AI-GM/1.0');
});

test('switching to Go can reuse an encrypted OpenCode key without exposing or changing it', async () => {
  const f = await fixture(() => completion('Ready.'));
  try {
    const before = f.db.prepare('SELECT encrypted_key FROM ai_credentials').get() as { encrypted_key: string };
    await f.ai.saveConnection(f.user.id, { provider: 'opencode-go', model: 'test-gm', apiKey: '' });
    assert.equal(f.ai.connection(f.user.id)?.provider, 'opencode-go');
    assert.deepEqual(f.db.prepare('SELECT encrypted_key FROM ai_credentials').get(), before);
    f.ai.start(f.user.id, f.campaign, { requestId: 'go-adventure', message: 'Begin.' });
    assert.equal((await finished(f.ai, f.user.id, f.campaign)).run?.status, 'complete');
    await assert.rejects(f.ai.saveConnection(f.user.id, { provider: 'openrouter', model: 'test-gm', apiKey: '' }));
  } finally { await f.close(); }
});

test('all quick-start classes have playable resources, equipment, cards and the legal starting trait distribution', async () => {
  const f = await fixture(() => completion('Ready.'));
  try {
    for (const cls of f.ai.classes) {
      const hero = quickHero('Ash', cls.id);
      assert.ok(getClass(hero.classId)); assert.equal(hero.domainCardIds.length, 2); assert.equal(hero.loadoutIds.length, 2);
      assert.deepEqual(Object.values(hero.traits).sort(), [-1, 0, 0, 1, 1, 2]);
      assert.ok(hpMax(hero) > 0); assert.ok(armorScore(hero) > 0); assert.equal(hero.weapons.length, 1);
    }
  } finally { await f.close(); }
});

test('AI creates a live scene, requests actual player dice, persists history and isolates private context', async () => {
  let calls = 0, heroId = '';
  const f = await fixture(body => {
    calls++;
    if (calls === 1) return completion(null, [{ id: 'scene', name: 'create_scene', args: { name: 'The lighthouse' } }, { id: 'roll', name: 'request_roll', args: { heroId, trait: 'instinct', difficulty: 12, reason: 'Find the hidden entrance.' } }, { id: 'memory', name: 'set_memory', args: { memory: 'The keeper is hiding below.' } }]);
    assert.ok(body.messages.some((message: any) => message.role === 'tool') || calls === 3);
    return completion(calls === 2 ? 'The storm beats against the lighthouse. What do you do?' : 'Your discovery leads you beneath the tower.');
  }); heroId = f.setup.heroId;
  try {
    const { ai, user, campaign, db, campaigns } = f;
    const player = await campaigns.register('aitestplayer', 'a temporary player password'); campaigns.acceptInvite(player.id, campaigns.createInvite(user.id, campaign));
    campaigns.saveNote(player.id, campaign, null, 'Private player secret', 'PLAYER_PRIVATE_SENTINEL', 'private');
    const outsider = await campaigns.register('aioutsider', 'a temporary outsider password');
    assert.throws(() => ai.session(outsider.id, campaign)); assert.throws(() => ai.configure(player.id, campaign, {}));
    const first = ai.start(user.id, campaign, { requestId: 'opening', message: 'Begin.' });
    assert.deepEqual(ai.start(user.id, campaign, { requestId: 'opening', message: 'Begin.' }), first);
    assert.throws(() => ai.start(user.id, campaign, { requestId: 'overlap', message: 'Again.' }), AiConflict);
    let state = await finished(ai, user.id, campaign); assert.equal(state.run?.status, 'complete');
    assert.equal(ai.actions.docs(campaign, 'map').filter(doc => doc.id.startsWith('scene:')).length, 1); assert.ok(f.published.includes('map/active'));
    const card = state.messages.find(message => message.interaction?.kind === 'roll')!; assert.ok(card);
    assert.equal(state.messages.at(-1)?.role, 'gm');
    const publicSession = ai.session(player.id, campaign); assert.equal(publicSession.memory, ''); assert.equal(publicSession.connection, null); assert.deepEqual(publicSession.actions, []);
    assert.ok(!JSON.stringify(publicSession).includes('keeper is hiding'));
    assert.ok(!f.requests.join('').includes('test-secret-never-in-context')); assert.ok(!f.requests.join('').includes('PLAYER_PRIVATE_SENTINEL'));
    const credential = db.prepare('SELECT encrypted_key FROM ai_credentials').get() as { encrypted_key: string }; assert.ok(!credential.encrypted_key.includes('test-secret'));
    ai.resolve(player.id, campaign, card.id, { advantage: 'normal' }); await finished(ai, user.id, campaign);
    const after = ai.actions.read(campaign, 'sheets', heroId); assert.ok(after);
    ai.resolve(player.id, campaign, card.id, {}); assert.deepEqual(ai.actions.read(campaign, 'sheets', heroId), after, 'a repeated click must not reroll or charge resources twice');
    state = ai.session(user.id, campaign); assert.equal(state.messages.filter(message => message.role === 'roll').length, 1); assert.equal(state.messages.find(message => message.id === card.id)?.interaction?.resolved, true);
    ai.pause(user.id, campaign, false); assert.throws(() => ai.start(user.id, campaign, { requestId: 'paused', message: 'Continue' }));
  } finally { await f.close(); }
});

test('retry resumes a checkpoint without spending Fear twice; stopping blocks prepared mutations', async () => {
  let calls = 0;
  const f = await fixture(() => { calls++; return calls === 1 ? completion(null, [{ id: 'fear', name: 'spend_fear', args: { amount: 1, reason: 'Extra spotlight' } }]) : calls === 2 ? json({ error: 'private upstream details' }, 503) : completion('The guardian advances.'); });
  try {
    const { ai, user, campaign } = f; ai.actions.write(campaign, 'combat', 'fear', { kind: 'fear', value: 4 });
    ai.start(user.id, campaign, { requestId: 'fear-test', message: 'Continue.' }); let state = await finished(ai, user.id, campaign);
    assert.equal(state.run?.status, 'failed'); assert.equal(ai.actions.read(campaign, 'combat', 'fear')?.value, 3);
    ai.retry(user.id, campaign, state.run!.id); state = await finished(ai, user.id, campaign);
    assert.equal(state.run?.status, 'complete'); assert.equal(ai.actions.read(campaign, 'combat', 'fear')?.value, 3);
    assert.equal(state.actions.filter(action => action.tool === 'spend_fear').length, 1);
  } finally { await f.close(); }
  let release: (value: Response) => void = () => {};
  const blocked = await fixture(() => new Promise<Response>(resolve => { release = resolve; }));
  try {
    blocked.ai.start(blocked.user.id, blocked.campaign, { requestId: 'stop-test', message: 'Begin.' });
    blocked.ai.cancel(blocked.user.id, blocked.campaign);
    release(completion(null, [{ id: 'late-scene', name: 'create_scene', args: { name: 'Must not exist' } }]));
    await finished(blocked.ai, blocked.user.id, blocked.campaign);
    assert.equal(blocked.ai.actions.docs(blocked.campaign, 'map').length, 0);
    assert.equal(blocked.ai.session(blocked.user.id, blocked.campaign).run?.status, 'cancelled');
  } finally { await blocked.close(); }
});

test('browser AI endpoints retain session, Origin and GM permission checks', async () => {
  const f = await fixture(() => completion('Ready.')), app = Fastify({ logger: false }), origin = 'http://localhost:4174';
  try {
    await registerCampaignRoutes(app, { service: f.campaigns, origin, secureCookies: false, allowRegistration: false });
    registerAiRoutes(app, { db: f.db, service: f.campaigns, secureCookies: false, provider: f.provider, publish: () => {}, publishRoll: () => {} });
    const cookie = `daggery_session=${f.campaigns.createSession(f.user.id)}`, url = `/api/campaigns/${f.campaign}/ai`;
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url, headers: { cookie } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'PUT', url: `${url}/enabled`, headers: { cookie }, payload: { enabled: false } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'PUT', url: `${url}/enabled`, headers: { cookie, origin }, payload: { enabled: false } })).statusCode, 200);
    const connection = await app.inject({ method: 'GET', url: '/api/ai/connection', headers: { cookie } }); assert.ok(!connection.body.includes('test-secret'));
  } finally { await app.close(); await f.close(); }
});

test('adversary attacks use source dice and Armor damage cards resolve once against actual hero defenses', async t => {
  const f = await fixture(() => completion('The strike lands. What do you do?'));
  try {
    t.mock.method(Math, 'random', () => .999);
    const { ai, user, campaign, db } = f;
    ai.start(user.id, campaign, { requestId: 'damage-setup', message: 'Begin combat.' }); await finished(ai, user.id, campaign);
    const turn = ai.session(user.id, campaign).run!.id;
    const ctx = { campaign, owner: user.id, turn, callId: '', assertActive: () => {}, publish: () => {}, publishRoll: () => {} };
    ai.actions.execute('create_scene', { name: 'Clifftop' }, { ...ctx, callId: 'combat-scene' });
    const source = adversaries.find(source => Number(source.attack.modifier) < 0) ?? adversaries[0]!;
    const enemy = ai.actions.execute('add_adversary', { catalogId: source.id }, { ...ctx, callId: 'enemy' }) as { adversaryId: string };
    const attack = ai.actions.execute('adversary_attack', { adversaryId: enemy.adversaryId, heroId: f.setup.heroId, reason: 'The hero left an opening.' }, { ...ctx, callId: 'attack' }) as { hit: boolean; damage: number };
    assert.equal(attack.hit, true); assert.ok(attack.damage > 0);
    const state = ai.session(user.id, campaign), card = state.messages.find(message => message.interaction?.kind === 'damage')!;
    assert.ok(card); assert.equal(card.interaction?.damage, attack.damage);
    ai.resolve(user.id, campaign, card.id, { useArmor: true }); await finished(ai, user.id, campaign);
    const after = ai.actions.read(campaign, 'sheets', f.setup.heroId)!;
    assert.ok(after.hpMarked <= hpMax(after as any)); assert.equal(after.armorSlotsMarked, 1);
    ai.resolve(user.id, campaign, card.id, { useArmor: true });
    assert.deepEqual(ai.actions.read(campaign, 'sheets', f.setup.heroId), after);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM ai_messages WHERE campaign_id=? AND role='roll'").get(campaign) as { n: number }).n, 2);
    const receipt = ai.actions.execute('set_condition', { targetId: enemy.adversaryId, condition: 'vulnerable', active: true, reason: 'Caught off guard' }, { ...ctx, callId: 'condition' }); assert.ok(receipt);
    assert.equal(ai.actions.read(campaign, 'combat', enemy.adversaryId)?.conditions.vulnerable, true);
  } finally { t.mock.restoreAll(); await f.close(); }
});
