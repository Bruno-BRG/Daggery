import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
test('asset uploads validate signatures and enforce campaign ownership', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'daggery-asset-'));
  const db = openCampaignDatabase(':memory:');
  const app = Fastify({ logger: false });
  try {
    const service = new CampaignService(db);
    const owner = await service.register('assetowner', 'a strong password here');
    const outsider = await service.register('assetoutsider', 'another strong password');
    const campaign = service.createCampaign(owner.id, 'Assets');
    await app.register(websocket);
    await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
    await registerCampaignRoutes(app, { service, origin, secureCookies: false, allowRegistration: false });
    await registerSecureGame(app, { db, service, origin, secureCookies: false, assetsDir: dir });
    const ownerCookie = `daggery_session=${service.createSession(owner.id)}`;
    const outsiderCookie = `daggery_session=${service.createSession(outsider.id)}`;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a0kAAAAASUVORK5CYII=', 'base64');
    const payload = (bytes: Buffer) => Buffer.concat([
      Buffer.from('--testboundary\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n'),
      bytes, Buffer.from('\r\n--testboundary--\r\n'),
    ]);
    const upload = (cookie: string, bytes: Buffer) => app.inject({ method: 'POST', url: `/api/campaigns/${campaign}/assets`, headers: { origin, cookie, 'content-type': 'multipart/form-data; boundary=testboundary' }, payload: payload(bytes) });
    assert.equal((await upload(ownerCookie, Buffer.from('<html>fake</html>'))).statusCode, 400);
    assert.equal((await upload(outsiderCookie, png)).statusCode, 403);
    assert.equal((await upload('', png)).statusCode, 401);
    const created = await upload(ownerCookie, png);
    assert.equal(created.statusCode, 201);
    const asset = created.json() as { url: string };
    assert.equal((await app.inject({ method: 'GET', url: asset.url, headers: { cookie: outsiderCookie } })).statusCode, 403);
    const response = await app.inject({ method: 'GET', url: asset.url, headers: { cookie: ownerCookie } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(response.rawPayload, png);
    const pdf = await upload(ownerCookie, Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF'));
    assert.equal(pdf.statusCode, 201);
    const pdfUrl = (pdf.json() as { url: string }).url;
    assert.equal((await app.inject({ method: 'GET', url: pdfUrl, headers: { cookie: ownerCookie } })).headers['content-disposition'], 'attachment');
    const inline = await app.inject({ method: 'GET', url: `${pdfUrl}?inline=1`, headers: { cookie: ownerCookie } });
    assert.equal(inline.headers['content-type'], 'application/pdf');
    assert.match(inline.headers['content-disposition'] as string, /^inline;/);

    // Character images are still uploadable by the campaign owner.
    const characterUpload = (cookie: string, bytes: Buffer, campaignId = campaign) => app.inject({ method: 'POST', url: `/api/campaigns/${campaignId}/character-images`, headers: { origin, cookie, 'content-type': 'multipart/form-data; boundary=testboundary' }, payload: payload(bytes) });
    const portrait = await characterUpload(ownerCookie, png);
    assert.equal(portrait.statusCode, 201);
    const portraitUrl = portrait.json().url as string;
    const image = await app.inject({ method: 'GET', url: portraitUrl, headers: { cookie: ownerCookie } });
    assert.equal(image.statusCode, 200);
    assert.deepEqual(image.rawPayload, png);
    assert.deepEqual(db.prepare("SELECT visibility,category FROM campaign_assets WHERE id=?").get(portrait.json().id), { visibility: 'shared', category: 'character' });
    assert.equal((await characterUpload(ownerCookie, Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF'))).statusCode, 400, 'character uploads cannot contain PDFs');
    assert.equal((await characterUpload(ownerCookie, Buffer.from('<svg></svg>'))).statusCode, 400);
    const oversizedDimensions = Buffer.from(png); oversizedDimensions.writeUInt32BE(9000, 16);
    assert.equal((await characterUpload(ownerCookie, oversizedDimensions)).statusCode, 400);
    assert.equal((await characterUpload(ownerCookie, Buffer.concat([png, Buffer.alloc(10 * 1024 * 1024)]))).statusCode, 413);
    assert.equal((await characterUpload(outsiderCookie, png)).statusCode, 403);
    assert.equal((await characterUpload('', png)).statusCode, 401);
    const anotherCampaign = service.createCampaign(owner.id, 'Other images');
    assert.equal((await app.inject({ method: 'GET', url: portraitUrl.replace(campaign, anotherCampaign), headers: { cookie: ownerCookie } })).statusCode, 404);
  } finally { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('WebSockets isolate campaigns, check origin and keep GM documents private', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'daggery-game-'));
  const db = openCampaignDatabase(':memory:');
  const app = Fastify({ logger: false });
  const sockets: WebSocket[] = [];
  try {
    const service = new CampaignService(db);
    const owner = await service.register('gm', 'a strong password here');
    const stranger = await service.register('other', 'yet another password');
    const campaign = service.createCampaign(owner.id, 'First');
    const other = service.createCampaign(stranger.id, 'Second');
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
    const a = await connect(owner.id, campaign);
    const b = await connect(stranger.id, other);
    assert.match(JSON.stringify(a.messages), /Hidden GM world/);
    assert.doesNotMatch(JSON.stringify(b.messages), /Hidden GM world/);
    const waitFor = async (predicate: () => boolean) => {
      const until = Date.now() + 2000;
      while (!predicate()) {
        if (Date.now() > until) throw new Error('document timeout');
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    };
    a.ws.send(JSON.stringify({ type: 'doc:set', ns: 'gm', id: 'scenario:test', value: { kind: 'scenario', title: 'Secret scenario' } }));
    await waitFor(() => a.messages.some(m => m.type === 'doc:set' && m.id === 'scenario:test'));
    const reconnected = await connect(owner.id, campaign);
    assert.match(JSON.stringify(reconnected.messages), /Secret scenario/);
    assert.doesNotMatch(JSON.stringify(b.messages), /Secret scenario/);
    a.ws.send(JSON.stringify({ type: 'doc:delete', ns: 'gm', id: 'scenario:test' }));
    await waitFor(() => a.messages.some(m => m.type === 'doc:delete' && m.id === 'scenario:test'));
    assert.equal(db.prepare("SELECT value FROM campaign_docs WHERE campaign_id = ? AND ns = 'gm' AND id = 'scenario:test'").get(campaign), undefined);
    a.ws.send(JSON.stringify({ type: 'doc:set', ns: 'sheets', id: 'hero', value: { name: 'Hero A' } }));
    await waitFor(() => a.messages.some(m => m.type === 'doc:set' && m.id === 'hero'));
    assert.doesNotMatch(JSON.stringify(b.messages), /Hero A/);
    // The map namespace was removed with group play, so it is rejected.
    const errorsBefore = a.messages.filter(m => m.type === 'error').length;
    a.ws.send(JSON.stringify({ type: 'doc:set', ns: 'map', id: 'scene:hack', value: { name: 'hack' } }));
    await waitFor(() => a.messages.filter(m => m.type === 'error').length > errorsBefore);
    assert.equal(db.prepare("SELECT id FROM campaign_docs WHERE id = 'scene:hack'").get(), undefined);
    a.ws.send(JSON.stringify({ type: 'roll', author: 'Different display name', clientRollId: 'regression-roll-1', kind: 'dice', result: { notation: '1d6', rolls: [4], modifier: 0, total: 4 } }));
    await waitFor(() => a.messages.some(m => m.type === 'roll'));
    const broadcastRoll = a.messages.find(m => m.type === 'roll')!.entry as Record<string, unknown>;
    assert.equal(broadcastRoll.author, owner.username, 'author must remain authenticated');
    assert.equal(broadcastRoll.clientRollId, 'regression-roll-1', 'the sender must recognize its echo despite the replaced author');
    const badOrigin = await app.inject({ method: 'GET', url: `/ws?campaign=${campaign}`, headers: { origin: 'http://evil.example', cookie: `daggery_session=${service.createSession(owner.id)}` } });
    assert.equal(badOrigin.statusCode, 403);
    const noAccess = await app.inject({ method: 'GET', url: `/api/campaigns/${campaign}/assets`, headers: { cookie: `daggery_session=${service.createSession(stranger.id)}` } });
    assert.equal(noAccess.statusCode, 403);
  } finally {
    for (const socket of sockets) socket.terminate();
    await app.close(); db.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('an owner can permanently delete an archived campaign with its asset files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'daggery-delete-'));
  const db = openCampaignDatabase(':memory:');
  const app = Fastify({ logger: false });
  try {
    const service = new CampaignService(db);
    const owner = await service.register('deletegm', 'a strong password here');
    const outsider = await service.register('deleteplayer', 'another strong password');
    const campaign = service.createCampaign(owner.id, 'Doomed');
    const kept = service.createCampaign(owner.id, 'Kept');
    await app.register(websocket);
    await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
    await registerCampaignRoutes(app, { service, origin, secureCookies: false, allowRegistration: false });
    await registerSecureGame(app, { db, service, origin, secureCookies: false, assetsDir: dir });
    const ownerCookie = `daggery_session=${service.createSession(owner.id)}`;
    const outsiderCookie = `daggery_session=${service.createSession(outsider.id)}`;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a0kAAAAASUVORK5CYII=', 'base64');
    const uploaded = await app.inject({ method: 'POST', url: `/api/campaigns/${campaign}/assets`, headers: { origin, cookie: ownerCookie, 'content-type': 'multipart/form-data; boundary=b' }, payload: Buffer.concat([Buffer.from('--b\r\nContent-Disposition: form-data; name="file"; filename="map.png"\r\nContent-Type: image/png\r\n\r\n'), png, Buffer.from('\r\n--b--\r\n')]) });
    assert.equal(uploaded.statusCode, 201);
    const file = (db.prepare('SELECT storage_name AS name FROM campaign_assets WHERE campaign_id = ?').get(campaign) as { name: string }).name;
    const remove = (cookie: string, id = campaign) => app.inject({ method: 'DELETE', url: `/api/campaigns/${id}`, headers: { origin, cookie } });
    assert.equal((await remove(ownerCookie)).statusCode, 400, 'an active campaign must be archived first');
    service.updateCampaign(owner.id, campaign, 'Doomed', '', true);
    assert.equal((await remove(outsiderCookie)).statusCode, 403, 'only the owner can delete');
    assert.equal((await remove('')).statusCode, 401);
    const deleted = await remove(ownerCookie);
    assert.equal(deleted.statusCode, 200);
    assert.deepEqual(deleted.json(), { deleted: true });
    const tables = (db.prepare("SELECT m.name FROM sqlite_master m WHERE m.type = 'table' AND EXISTS (SELECT 1 FROM pragma_table_info(m.name) WHERE name = 'campaign_id')").all() as { name: string }[]).map(row => row.name);
    for (const table of tables) assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE campaign_id = ?`).get(campaign) as { n: number }).n, 0, `${table} is cleared`);
    assert.equal(db.prepare('SELECT 1 FROM campaigns WHERE id = ?').get(campaign), undefined);
    assert.ok(!existsSync(join(dir, file)), 'the uploaded file is removed from disk');
    assert.ok(db.prepare('SELECT 1 FROM campaigns WHERE id = ?').get(kept), 'other campaigns are untouched');
    assert.equal((await remove(ownerCookie)).statusCode, 403, 'a deleted campaign cannot be deleted again');
  } finally { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});
