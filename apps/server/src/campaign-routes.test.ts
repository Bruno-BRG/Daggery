import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import Fastify from 'fastify';
import { openCampaignDatabase } from './campaign-db';
import { registerCampaignRoutes } from './campaign-routes';
import { CampaignService } from './campaign-service';

test('HTTP API requires origin, session and campaign ownership', async () => {
  const db = openCampaignDatabase(':memory:');
  const app = Fastify({ logger: false });
  const origin = 'https://daggery.example';
  try {
    const service = new CampaignService(db);
    const owner = await service.register('gm', 'a strong password here');
    const outsider = await service.register('stranger', 'a third long password');
    const campaign = service.createCampaign(owner.id, 'Test');
    const secret = service.saveNote(owner.id, campaign, null, 'Private', 'secret', 'private');
    await registerCampaignRoutes(app, { service, origin, secureCookies: true, allowRegistration: false });
    const login = await app.inject({ method: 'POST', url: '/api/login', headers: { origin }, payload: { username: owner.username, password: 'a strong password here' } });
    assert.equal(login.statusCode, 200);
    const setCookie = login.headers['set-cookie'] as string;
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(';')[0]!;
    const forbiddenCsrf = await app.inject({ method: 'POST', url: '/api/campaigns', headers: { cookie, origin: 'https://evil.example' }, payload: { name: 'bad' } });
    assert.equal(forbiddenCsrf.statusCode, 403);
    const noSession = await app.inject({ method: 'GET', url: '/api/campaigns' });
    assert.equal(noSession.statusCode, 401);
    const notes = await app.inject({ method: 'GET', url: `/api/campaigns/${campaign}/notes`, headers: { cookie } });
    assert.deepEqual((notes.json().notes as { id: string }[]).map(note => note.id), [secret]);
    const remove = await app.inject({ method: 'DELETE', url: `/api/campaigns/${campaign}/notes/${secret}`, headers: { cookie, origin } });
    assert.equal(remove.statusCode, 200);
    const outsiderCookie = `__Host-daggery_session=${service.createSession(outsider.id)}`;
    assert.equal((await app.inject({ method: 'GET', url: `/api/campaigns/${campaign}/notes`, headers: { cookie: outsiderCookie } })).statusCode, 403);
    // Group play endpoints are gone.
    assert.equal((await app.inject({ method: 'GET', url: `/api/campaigns/${campaign}/members`, headers: { cookie } })).statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', url: `/api/campaigns/${campaign}/invites`, headers: { cookie, origin } })).statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', url: '/api/invites/accept', headers: { cookie, origin }, payload: { token: 'x' } })).statusCode, 404);
    const registration = await app.inject({ method: 'POST', url: '/api/register', headers: { origin }, payload: {} });
    assert.equal(registration.statusCode, 403);
    const logout = await app.inject({ method: 'POST', url: '/api/logout', headers: { cookie, origin } });
    assert.equal(logout.statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/campaigns', headers: { cookie } })).statusCode, 401);
  } finally {
    await app.close();
    db.close();
  }
});

test('export then import round-trips docs and notes into a new campaign', async () => {
  const db = openCampaignDatabase(':memory:');
  const app = Fastify({ logger: false });
  const origin = 'https://daggery.example';
  try {
    const service = new CampaignService(db);
    const owner = await service.register('exporter', 'a strong export password');
    const campaign = service.createCampaign(owner.id, 'Solo', 'My campaign', { systemId: 'daggerheart', rulesetId: 'solo' });
    db.prepare('INSERT INTO campaign_docs VALUES (?,?,?,?,?)').run(campaign, 'sheets', 'hero', JSON.stringify({ id: 'hero', name: 'Aria' }), '2026');
    db.prepare('INSERT INTO campaign_docs VALUES (?,?,?,?,?)').run(campaign, 'map', 'scene:1', JSON.stringify({ name: 'old map' }), '2026');
    service.saveNote(owner.id, campaign, null, 'Session log', 'Met the keeper', 'shared');
    await registerCampaignRoutes(app, { service, origin, secureCookies: true, allowRegistration: false });
    const cookie = `__Host-daggery_session=${service.createSession(owner.id)}`;

    const exported = await app.inject({ method: 'GET', url: `/api/campaigns/${campaign}/export`, headers: { cookie } });
    assert.equal(exported.statusCode, 200);
    assert.equal(exported.headers['content-disposition'], 'attachment; filename="solo.daggery.json"');
    const data = exported.json() as Record<string, unknown>;
    assert.equal(data.format, 'daggery-campaign');
    assert.equal(data.version, 1);
    assert.deepEqual((data.campaign as Record<string, unknown>).configuration, { systemId: 'daggerheart', rulesetId: 'solo', options: { partyMode: 'lone', fearThreshold: 3, partySize: 2 } });
    assert.ok((data.docs as { ns: string }[]).some(doc => doc.ns === 'sheets'));
    assert.deepEqual(data.notes, [{ title: 'Session log', body: 'Met the keeper' }]);

    assert.equal((await app.inject({ method: 'POST', url: '/api/campaigns/import', headers: { cookie, origin }, payload: { ...data, format: 'other' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/campaigns/import', headers: { cookie, origin }, payload: { ...data, version: 2 } })).statusCode, 400);

    const imported = await app.inject({ method: 'POST', url: '/api/campaigns/import', headers: { cookie, origin }, payload: data });
    assert.equal(imported.statusCode, 201);
    const restored = imported.json().campaign as { id: string; name: string; description: string; role: string };
    assert.notEqual(restored.id, campaign);
    assert.equal(restored.name, 'Solo (imported)');
    assert.equal(restored.description, 'My campaign');
    assert.equal(restored.role, 'gm');
    assert.equal(JSON.parse((db.prepare("SELECT value FROM campaign_docs WHERE campaign_id = ? AND ns = 'sheets' AND id = 'hero'").get(restored.id) as { value: string }).value).name, 'Aria');
    assert.equal(db.prepare("SELECT 1 FROM campaign_docs WHERE campaign_id = ? AND ns = 'map'").get(restored.id), undefined, 'imports only namespaces the solo ruleset allows');
    assert.deepEqual(db.prepare('SELECT title, body, visibility FROM campaign_notes WHERE campaign_id = ?').get(restored.id), { title: 'Session log', body: 'Met the keeper', visibility: 'shared' });
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM campaigns').get() as { n: number }).n, 2);

    const oversized = 'x'.repeat(10 * 1024 * 1024 + 1);
    assert.equal((await app.inject({ method: 'POST', url: '/api/campaigns/import', headers: { cookie, origin, 'content-type': 'application/json' }, payload: oversized })).statusCode, 413);
  } finally {
    await app.close();
    db.close();
  }
});
