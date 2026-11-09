import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import Fastify from 'fastify';
import { openCampaignDatabase } from './campaign-db';
import { registerCampaignRoutes } from './campaign-routes';
import { CampaignService } from './campaign-service';

test('HTTP API requires origin, session and campaign membership', async () => {
  const db = openCampaignDatabase(':memory:');
  const app = Fastify({ logger: false });
  const origin = 'https://daggery.example';
  try {
    const service = new CampaignService(db);
    const gm = await service.register('gm', 'a strong password here');
    const player = await service.register('player', 'another password here');
    const outsider = await service.register('stranger', 'a third long password');
    const campaign = service.createCampaign(gm.id, 'Test');
    service.acceptInvite(player.id, service.createInvite(gm.id, campaign));
    const secret = service.saveNote(player.id, campaign, null, 'Private', 'secret', 'private');
    await registerCampaignRoutes(app, { service, origin, secureCookies: true, allowRegistration: false });
    const login = await app.inject({ method: 'POST', url: '/api/login', headers: { origin }, payload: { username: gm.username, password: 'a strong password here' } });
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
    assert.deepEqual(notes.json(), { notes: [] });
    const steal = await app.inject({ method: 'DELETE', url: `/api/campaigns/${campaign}/notes/${secret}`, headers: { cookie, origin } });
    assert.equal(steal.statusCode, 403);
    const outsiderCookie = `__Host-daggery_session=${service.createSession(outsider.id)}`;
    const membersUrl = `/api/campaigns/${campaign}/members`;
    assert.equal((await app.inject({ method: 'GET', url: membersUrl })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: membersUrl, headers: { cookie: outsiderCookie } })).statusCode, 403);
    const playerCookie = `__Host-daggery_session=${service.createSession(player.id)}`;
    const members = (await app.inject({ method: 'GET', url: membersUrl, headers: { cookie: playerCookie } })).json().members;
    assert.deepEqual(members, [{ ...gm, role: 'gm' }, { ...player, role: 'player' }]);
    assert.deepEqual(Object.keys(members[0]!).sort(), ['id', 'role', 'username']);
    const wrongCampaign = await app.inject({ method: 'GET', url: `/api/campaigns/${campaign}/notes`, headers: { cookie: outsiderCookie } });
    assert.equal(wrongCampaign.statusCode, 403);
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
