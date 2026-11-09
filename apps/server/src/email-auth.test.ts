import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import Fastify from 'fastify';
import { openCampaignDatabase } from './campaign-db';
import { CampaignService } from './campaign-service';
import { registerCampaignRoutes } from './campaign-routes';
import { EmailAuth } from './email-auth';

const origin = 'http://localhost:5173';
test('email login uses expiring one-time codes and preserves cookie security', async () => {
  const db = openCampaignDatabase(':memory:');
  const app = Fastify();
  const sent: { email: string; code: string }[] = [];
  try {
    const service = new CampaignService(db);
    const emailAuth = new EmailAuth(db, async (email, code) => { sent.push({ email, code }); }, true);
    await registerCampaignRoutes(app, { service, origin, secureCookies: false, allowRegistration: true, emailAuth });
    const post = (url: string, payload: object, cookie?: string) => app.inject({ method: 'POST', url, headers: { origin, ...(cookie ? { cookie } : {}) }, payload });
    assert.equal((await post('/api/email/request', { email: 'Player@Example.org' })).statusCode, 200);
    assert.equal(sent[0]?.email, 'player@example.org');
    const code = sent[0]!.code;
    assert.match(code, /^\d{8}$/);
    assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM email_codes').get()), new RegExp(code));
    assert.equal((await post('/api/email/verify', { email: 'player@example.org', code: code === '00000000' ? '00000001' : '00000000' })).statusCode, 401);
    const verified = await post('/api/email/verify', { email: 'player@example.org', code });
    assert.equal(verified.statusCode, 200);
    assert.match(String(verified.headers['set-cookie']), /HttpOnly; SameSite=Strict/);
    assert.equal((await post('/api/email/verify', { email: 'player@example.org', code })).statusCode, 401);
    const user = verified.json().user as { id: string; username: string };
    assert.equal(await service.authenticate(user.username, 'any password'), null);
    assert.equal(service.session(String(verified.headers['set-cookie']).split(';')[0]!.split('=')[1]!)?.id, user.id);
    await emailAuth.request('expiry@example.org', 'login', null);
    const expired = sent[1]!.code;
    db.prepare("UPDATE email_codes SET expires_at = '2000-01-01T00:00:00.000Z' WHERE email = ?").run('expiry@example.org');
    assert.equal(emailAuth.consume('expiry@example.org', expired, 'login', null), null);
    await emailAuth.request('attempts@example.org', 'login', null);
    const valid = sent[2]!.code;
    const wrong = valid === '00000000' ? '00000001' : '00000000';
    for (let i = 0; i < 5; i++) assert.equal(emailAuth.consume('attempts@example.org', wrong, 'login', null), null);
    assert.equal(emailAuth.consume('attempts@example.org', valid, 'login', null), null);
  } finally { await app.close(); db.close(); }
});

test('linking requires the original session and cannot steal a verified email', async () => {
  const db = openCampaignDatabase(':memory:');
  const sent: string[] = [];
  try {
    const service = new CampaignService(db);
    const first = await service.register('first', 'correct password for first');
    const second = await service.register('second', 'correct password for second');
    const auth = new EmailAuth(db, async (_email, code) => { sent.push(code); }, true);
    await auth.request('first@example.org', 'link', first.id);
    assert.equal(auth.consume('first@example.org', sent[0]!, 'link', second.id), null);
    assert.equal(auth.consume('first@example.org', sent[0]!, 'link', first.id)?.id, first.id);
    await auth.request('first@example.org', 'link', second.id);
    assert.equal(sent.length, 1);
    assert.equal(auth.consume('first@example.org', sent[0]!, 'link', second.id), null);
    await auth.request('first@example.org', 'login', null);
    assert.equal(auth.consume('first@example.org', sent[1]!, 'login', null)?.id, first.id);
    const disabled = new EmailAuth(db, async (_email, code) => { sent.push(code); }, false);
    await disabled.request('new@example.org', 'login', null);
    assert.equal(sent.length, 2);
  } finally { db.close(); }
});

test('unconfigured email provider fails explicitly and mismatched origins are rejected', async () => {
  const db = openCampaignDatabase(':memory:');
  const app = Fastify();
  try {
    await registerCampaignRoutes(app, { service: new CampaignService(db), origin, secureCookies: false, allowRegistration: true });
    assert.equal((await app.inject({ method: 'POST', url: '/api/email/request', headers: { origin }, payload: { email: 'p@example.org' } })).statusCode, 503);
    assert.equal((await app.inject({ method: 'POST', url: '/api/email/request', headers: { origin: 'http://evil.example' }, payload: { email: 'p@example.org' } })).statusCode, 403);
  } finally { await app.close(); db.close(); }
});
