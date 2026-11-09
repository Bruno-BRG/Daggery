import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import WebSocket from 'ws';
import { openCampaignDatabase } from './campaign-db';
import { CampaignService } from './campaign-service';
import { registerCampaignRoutes } from './campaign-routes';
import { registerSecureGame } from './secure-game';

const origin = 'http://localhost:5173';
test('asset uploads validate signatures and enforce campaign membership', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'daggery-asset-'));
  const db = openCampaignDatabase(':memory:');
  const app = Fastify({ logger: false });
  try {
    const service = new CampaignService(db);
    const gm = await service.register('assetgm', 'a strong password here');
    const player = await service.register('assetplayer', 'another strong password');
    const campaign = service.createCampaign(gm.id, 'Assets');
    service.acceptInvite(player.id, service.createInvite(gm.id, campaign));
    await app.register(websocket);
    await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
    await registerCampaignRoutes(app, { service, origin, secureCookies: false, allowRegistration: false });
    await registerSecureGame(app, { db, service, origin, secureCookies: false, assetsDir: dir });
    const gmCookie = `daggery_session=${service.createSession(gm.id)}`;
    const playerCookie = `daggery_session=${service.createSession(player.id)}`;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a0kAAAAASUVORK5CYII=', 'base64');
    const payload = (bytes: Buffer) => Buffer.concat([
      Buffer.from('--testboundary\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n'),
      bytes, Buffer.from('\r\n--testboundary--\r\n'),
    ]);
    const upload = (cookie: string, bytes: Buffer) => app.inject({ method: 'POST', url: `/api/campaigns/${campaign}/assets`, headers: { origin, cookie, 'content-type': 'multipart/form-data; boundary=testboundary' }, payload: payload(bytes) });
    assert.equal((await upload(gmCookie, Buffer.from('<html>fake</html>'))).statusCode, 400);
    assert.equal((await upload(playerCookie, png)).statusCode, 403);
    const created = await upload(gmCookie, png);
    assert.equal(created.statusCode, 201);
    const asset = created.json() as { url: string };
    assert.equal((await app.inject({ method: 'GET', url: asset.url, headers: { cookie: playerCookie } })).statusCode, 404);
    const response = await app.inject({ method: 'GET', url: asset.url, headers: { cookie: gmCookie } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(response.rawPayload, png);
    const pdf = await upload(gmCookie, Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF'));
    assert.equal(pdf.statusCode, 201);
    const pdfUrl = (pdf.json() as { url: string }).url;
    assert.equal((await app.inject({ method: 'GET', url: pdfUrl, headers: { cookie: gmCookie } })).headers['content-disposition'], 'attachment');
    const inline = await app.inject({ method: 'GET', url: `${pdfUrl}?inline=1`, headers: { cookie: gmCookie } });
    assert.equal(inline.headers['content-type'], 'application/pdf');
    assert.match(inline.headers['content-disposition'] as string, /^inline;/);
    assert.equal((await app.inject({ method: 'GET', url: `${pdfUrl}?inline=1`, headers: { cookie: playerCookie } })).statusCode, 404);
  } finally { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('WebSockets isolate campaigns, check origin and hide GM documents from players', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'daggery-game-'));
  const db = openCampaignDatabase(':memory:');
  const app = Fastify({ logger: false });
  const sockets: WebSocket[] = [];
  try {
    const service = new CampaignService(db);
    const gm = await service.register('gm', 'a strong password here');
    const player = await service.register('player', 'another strong password');
    const stranger = await service.register('other', 'yet another password');
    const campaign = service.createCampaign(gm.id, 'First');
    const other = service.createCampaign(stranger.id, 'Second');
    service.acceptInvite(player.id, service.createInvite(gm.id, campaign));
    db.prepare('INSERT INTO campaign_docs VALUES (?, ?, ?, ?, ?)').run(campaign, 'map', 'token:hidden', JSON.stringify({ hidden: true, name: 'secret' }), '2025');
    db.prepare('INSERT INTO campaign_docs VALUES (?, ?, ?, ?, ?)').run(campaign, 'gm', 'setting', JSON.stringify({ kind: 'setting', title: 'Hidden GM world' }), '2025');
    await app.register(websocket, { options: { maxPayload: 65536 } });
    await app.register(multipart);
    await registerCampaignRoutes(app, { service, origin, secureCookies: false, allowRegistration: false });
    await registerSecureGame(app, { db, service, origin, secureCookies: false, assetsDir: dir });
    const url = await app.listen({ host: '127.0.0.1', port: 0 });
    async function connect(userId: string, campaignId: string) {
      const session = service.createSession(userId);
      const ws = new WebSocket(`${url.replace('http:', 'ws:')}/ws?campaign=${campaignId}`, { headers: { origin, cookie: `daggery_session=${session}` } });
      sockets.push(ws);
      const messages: Array<Record<string, unknown>> = [];
      ws.on('message', data => messages.push(JSON.parse(data.toString()) as Record<string, unknown>));
      await once(ws, 'open');
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('snapshot timeout')), 2000);
        const check = () => { if (messages.some(m => m.type === 'docs:snapshot')) { clearTimeout(timeout); resolve(); } else setTimeout(check, 5); };
        check();
      });
      return { ws, messages };
    }
    const a = await connect(gm.id, campaign);
    const b = await connect(player.id, campaign);
    const c = await connect(stranger.id, other);
    assert.match(JSON.stringify(a.messages), /secret/);
    assert.doesNotMatch(JSON.stringify(b.messages), /secret/);
    assert.match(JSON.stringify(a.messages), /Hidden GM world/);
    assert.doesNotMatch(JSON.stringify(b.messages), /Hidden GM world/);
    const waitFor = async (predicate: () => boolean) => {
      const until = Date.now() + 2000;
      while (!predicate()) {
        if (Date.now() > until) throw new Error('GM document timeout');
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    };
    a.ws.send(JSON.stringify({ type: 'doc:set', ns: 'gm', id: 'scenario:test', value: { kind: 'scenario', title: 'Secret scenario' } }));
    await waitFor(() => a.messages.some(m => m.type === 'doc:set' && m.id === 'scenario:test'));
    const reconnected = await connect(gm.id, campaign);
    assert.match(JSON.stringify(reconnected.messages), /Secret scenario/);
    assert.doesNotMatch(JSON.stringify(b.messages), /Secret scenario/);
    assert.doesNotMatch(JSON.stringify(c.messages), /Secret scenario/);
    for (const type of ['doc:set', 'doc:delete']) {
      const errorsBefore = b.messages.filter(m => m.type === 'error').length;
      b.ws.send(JSON.stringify({ type, ns: 'gm', id: 'scenario:test', value: { title: 'tampered' } }));
      await waitFor(() => b.messages.filter(m => m.type === 'error').length > errorsBefore);
      const stored = db.prepare("SELECT value FROM campaign_docs WHERE campaign_id = ? AND ns = 'gm' AND id = 'scenario:test'").get(campaign) as { value: string };
      assert.match(stored.value, /Secret scenario/);
    }
    a.ws.send(JSON.stringify({ type: 'doc:delete', ns: 'gm', id: 'scenario:test' }));
    await waitFor(() => a.messages.some(m => m.type === 'doc:delete' && m.id === 'scenario:test'));
    assert.equal(db.prepare("SELECT value FROM campaign_docs WHERE campaign_id = ? AND ns = 'gm' AND id = 'scenario:test'").get(campaign), undefined);
    a.ws.send(JSON.stringify({ type: 'doc:set', ns: 'sheets', id: 'hero', value: { name: 'Hero A' } }));
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('broadcast timeout')), 2000);
      const check = () => { if (b.messages.some(m => m.type === 'doc:set')) { clearTimeout(timeout); resolve(); } else setTimeout(check, 5); };
      check();
    });
    assert.doesNotMatch(JSON.stringify(c.messages), /Hero A/);
    b.ws.send(JSON.stringify({ type: 'doc:set', ns: 'map', id: 'scene:hack', value: { name: 'hack' } }));
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('error timeout')), 2000);
      const check = () => { if (b.messages.some(m => m.type === 'error')) { clearTimeout(timeout); resolve(); } else setTimeout(check, 5); };
      check();
    });
    assert.equal(db.prepare("SELECT id FROM campaign_docs WHERE id = 'scene:hack'").get(), undefined);
    a.ws.send(JSON.stringify({ type: 'roll', author: 'Different display name', clientRollId: 'regression-roll-1', kind: 'dice', result: { notation: '1d6', rolls: [4], modifier: 0, total: 4 } }));
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('roll broadcast timeout')), 2000);
      const check = () => { if (b.messages.some(m => m.type === 'roll')) { clearTimeout(timeout); resolve(); } else setTimeout(check, 5); };
      check();
    });
    const broadcastRoll = b.messages.find(m => m.type === 'roll')!.entry as Record<string, unknown>;
    assert.equal(broadcastRoll.author, gm.username, 'author must remain authenticated');
    assert.equal(broadcastRoll.clientRollId, 'regression-roll-1', 'the sender must recognize its echo despite the replaced author');
    assert.doesNotMatch(JSON.stringify(c.messages), /regression-roll-1/);
    const badOrigin = await app.inject({ method: 'GET', url: `/ws?campaign=${campaign}`, headers: { origin: 'http://evil.example', cookie: `daggery_session=${service.createSession(gm.id)}` } });
    assert.equal(badOrigin.statusCode, 403);
    const noAccess = await app.inject({ method: 'GET', url: `/api/campaigns/${campaign}/assets`, headers: { cookie: `daggery_session=${service.createSession(stranger.id)}` } });
    assert.equal(noAccess.statusCode, 403);
  } finally {
    for (const socket of sockets) socket.terminate();
    await app.close(); db.close(); rmSync(dir, { recursive: true, force: true });
  }
});
