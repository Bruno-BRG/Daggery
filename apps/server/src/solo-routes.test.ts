import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import { initialSoloState } from '@daggery/shared';
import { openCampaignDatabase } from './campaign-db';
import { CampaignService } from './campaign-service';
import { registerCampaignRoutes } from './campaign-routes';
import { registerSecureGame } from './secure-game';

test('solo HTTP endpoints validate configurations, membership, CSRF, revisions and resource isolation', async () => {
  const db = openCampaignDatabase(':memory:'), app = Fastify({ logger: false });
  const assetsDir = mkdtempSync(join(tmpdir(), 'solo-routes-')), origin = 'http://localhost:5173';
  try {
    const service = new CampaignService(db);
    const owner = await service.register('owner', 'an owner strong password'), other = await service.register('other', 'another strong password');
    await app.register(websocket); await app.register(multipart);
    await registerCampaignRoutes(app, { service, origin, secureCookies: false, allowRegistration: false });
    await registerSecureGame(app, { db, service, origin, secureCookies: false, assetsDir });
    const cookie = `daggery_session=${service.createSession(owner.id)}`, outsider = `daggery_session=${service.createSession(other.id)}`;
    const created = await app.inject({ method: 'POST', url: '/api/campaigns', headers: { origin, cookie }, payload: { name: 'Solo', configuration: { systemId: 'daggerheart', rulesetId: 'solo' } } });
    assert.equal(created.statusCode, 201);
    const id = created.json().id as string, base = `/api/campaigns/${id}/solo`;
    assert.equal((await app.inject({ method: 'POST', url: '/api/campaigns', headers: { origin, cookie }, payload: { name: 'Bad', configuration: { systemId: 'unknown', rulesetId: 'solo' } } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'GET', url: base })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: base, headers: { cookie: outsider } })).statusCode, 403);
    // Even an imported player membership cannot read GM-only solo state.
    db.prepare("INSERT INTO campaign_members VALUES (?, ?, 'player')").run(id, other.id);
    assert.equal((await app.inject({ method: 'GET', url: base, headers: { cookie: outsider } })).statusCode, 403);
    const state = initialSoloState(); state.scene.title = 'Private';
    assert.equal((await app.inject({ method: 'PUT', url: `${base}/state`, headers: { origin: 'http://evil.test', cookie }, payload: state })).statusCode, 403);
    assert.equal((await app.inject({ method: 'PUT', url: `${base}/state`, headers: { origin, cookie }, payload: state })).statusCode, 200);
    const conflict = await app.inject({ method: 'PUT', url: `${base}/state`, headers: { origin, cookie }, payload: state });
    assert.equal(conflict.statusCode, 409); assert.match(conflict.json().error, /another window/);
    const before = db.prepare("SELECT value FROM campaign_docs WHERE campaign_id = ? AND ns = 'combat'").get(id);
    const roll = await app.inject({ method: 'POST', url: `${base}/roll`, headers: { origin, cookie }, payload: { requestId: 'oracle-1', kind: 'oracle', question: 'Is it occupied?', likelihood: 'even' } });
    assert.equal(roll.statusCode, 200);
    assert.equal((await app.inject({ method: 'PUT', url: `${base}/entries/oracle-1`, headers: { origin, cookie }, payload: { interpretation: 'The hut is empty.' } })).statusCode, 200);
    const reloaded = (await app.inject({ method: 'GET', url: base, headers: { cookie } })).json();
    assert.equal(reloaded.state.scene.title, 'Private'); assert.equal(reloaded.entries[0].interpretation, 'The hut is empty.');
    assert.deepEqual(db.prepare("SELECT value FROM campaign_docs WHERE campaign_id = ? AND ns = 'combat'").get(id), before);
    assert.equal((await app.inject({ method: 'POST', url: `${base}/roll`, headers: { origin, cookie }, payload: { requestId: 'invalid', kind: 'oracle', question: 'Q', likelihood: 'wrong' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: `/api/campaigns/${id}/invites`, headers: { origin, cookie } })).statusCode, 400);
  } finally { await app.close(); db.close(); rmSync(assetsDir, { recursive: true, force: true }); }
});
