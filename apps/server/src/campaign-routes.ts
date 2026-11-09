import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CampaignService, type NoteVisibility, type User } from './campaign-service';
import type { EmailAuth } from './email-auth';

interface Options {
  service: CampaignService;
  /** Exact browser origin, including scheme and port. */
  origin: string;
  allowRegistration: boolean;
  secureCookies: boolean;
  emailAuth?: EmailAuth;
}

const object = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === 'string' ? value : '';

export function readSessionToken(cookieHeader: string | undefined, secureCookies: boolean): string {
  const cookieName = secureCookies ? '__Host-daggery_session' : 'daggery_session';
  const values = (cookieHeader ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${cookieName}=`));
  return values.length === 1 ? values[0]!.slice(cookieName.length + 1) : '';
}

export async function registerCampaignRoutes(app: FastifyInstance, options: Options): Promise<void> {
  const { service, origin, secureCookies, allowRegistration } = options;
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.origin !== origin || (!secureCookies && parsedOrigin.protocol !== 'http:')) throw new Error('Invalid application origin');
  if (secureCookies && parsedOrigin.protocol !== 'https:') throw new Error('Secure cookies require HTTPS');

  const cookieName = secureCookies ? '__Host-daggery_session' : 'daggery_session';
  const cookie = (value: string, age: number) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secureCookies ? '; Secure' : ''}`;
  const sessionToken = (request: FastifyRequest): string => readSessionToken(request.headers.cookie, secureCookies);
  const currentUser = (request: FastifyRequest): User | null => service.session(sessionToken(request));
  const requireUser = (request: FastifyRequest): User => {
    const user = currentUser(request);
    if (!user) throw new Error('Unauthorized');
    return user;
  };
  const campaignId = (request: FastifyRequest): string => text(object(request.params).campaignId);
  const noteId = (request: FastifyRequest): string => text(object(request.params).noteId);
  const attempts = new Map<string, { count: number; until: number }>();
  function throttle(request: FastifyRequest, reply: FastifyReply): boolean {
    const time = Date.now();
    for (const [key, value] of attempts) if (value.until <= time) attempts.delete(key);
    const key = request.ip;
    const bucket = attempts.get(key) ?? { count: 0, until: time + 15 * 60_000 };
    if (bucket.count >= 10 || (attempts.size >= 10_000 && !attempts.has(key))) {
      void reply.code(429).send({ error: 'Too many attempts' });
      return false;
    }
    bucket.count++;
    attempts.set(key, bucket);
    return true;
  }

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin !== origin) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    reply.header('Cache-Control', 'no-store');
  });
  app.setErrorHandler((error, _request, reply) => {
    if (!(error instanceof Error)) return reply.code(500).send({ error: 'Request failed' });
    if (error.message === 'Unauthorized') return reply.code(401).send({ error: 'Unauthorized' });
    if (error.message === 'Forbidden' || error.message === 'Invalid invite') return reply.code(403).send({ error: 'Forbidden' });
    if (error.message.startsWith('Invalid ')) return reply.code(400).send({ error: error.message.slice(0, 500) });
    // Do not expose SQL errors, credentials or invitation tokens.
    return reply.code(500).send({ error: 'Request failed' });
  });

  app.post('/api/register', async (request, reply) => {
    if (!allowRegistration) return reply.code(403).send({ error: 'Registration disabled' });
    if (!throttle(request, reply)) return;
    const body = object(request.body);
    try {
      await service.register(text(body.username), text(body.password));
      return reply.code(201).send({ ok: true });
    } catch {
      return reply.code(400).send({ error: 'Unable to register' });
    }
  });
  app.post('/api/login', async (request, reply) => {
    if (!throttle(request, reply)) return;
    const body = object(request.body);
    const user = await service.authenticate(text(body.username), text(body.password));
    if (!user) return reply.code(401).send({ error: 'Invalid credentials' });
    reply.header('Set-Cookie', cookie(service.createSession(user.id), 7 * 86400));
    return { user };
  });
  app.post('/api/email/request', async (request, reply) => {
    if (!options.emailAuth) return reply.code(503).send({ error: 'Email login unavailable' });
    if (!throttle(request, reply)) return;
    const body = object(request.body);
    try { await options.emailAuth.request(text(body.email), 'login', null); }
    catch (error) {
      if (error instanceof Error && error.message === 'Invalid email') return reply.code(400).send({ error: 'Invalid input' });
      return reply.code(503).send({ error: 'Email delivery unavailable' });
    }
    return { ok: true };
  });
  app.post('/api/email/verify', async (request, reply) => {
    if (!options.emailAuth) return reply.code(503).send({ error: 'Email login unavailable' });
    if (!throttle(request, reply)) return;
    const body = object(request.body);
    const user = options.emailAuth.consume(text(body.email), text(body.code), 'login', null);
    if (!user) return reply.code(401).send({ error: 'Invalid or expired code' });
    reply.header('Set-Cookie', cookie(service.createSession(user.id), 7 * 86400));
    return { user };
  });
  app.post('/api/email/link/request', async (request, reply) => {
    if (!options.emailAuth) return reply.code(503).send({ error: 'Email login unavailable' });
    if (!throttle(request, reply)) return;
    const user = requireUser(request), body = object(request.body);
    try { await options.emailAuth.request(text(body.email), 'link', user.id); }
    catch (error) {
      if (error instanceof Error && error.message === 'Invalid email') return reply.code(400).send({ error: 'Invalid input' });
      return reply.code(503).send({ error: 'Email delivery unavailable' });
    }
    return { ok: true };
  });
  app.post('/api/email/link/verify', async (request, reply) => {
    if (!options.emailAuth) return reply.code(503).send({ error: 'Email login unavailable' });
    if (!throttle(request, reply)) return;
    const user = requireUser(request), body = object(request.body);
    if (!options.emailAuth.consume(text(body.email), text(body.code), 'link', user.id)) return reply.code(400).send({ error: 'Invalid or expired code' });
    return { ok: true };
  });
  app.post('/api/logout', async (request, reply) => {
    service.revokeSession(sessionToken(request));
    reply.header('Set-Cookie', cookie('', 0));
    return { ok: true };
  });
  app.get('/api/me', async (request) => ({ user: currentUser(request) }));
  app.get('/api/campaigns', async (request) => ({ campaigns: service.listCampaigns(requireUser(request).id) }));
  app.get('/api/campaigns/:campaignId/members', async (request) => ({ members: service.listMembers(requireUser(request).id, campaignId(request)) }));
  app.post('/api/campaigns', async (request, reply) => {
    const user = requireUser(request), body = object(request.body);
    const id = service.createCampaign(user.id, text(body.name), text(body.description), body.configuration);
    return reply.code(201).send({ id });
  });
  app.patch('/api/campaigns/:campaignId', async (request) => {
    const user = requireUser(request), body = object(request.body);
    service.updateCampaign(user.id, campaignId(request), text(body.name), text(body.description), body.archived as boolean, body.configuration);
    return { ok: true };
  });
  app.post('/api/campaigns/:campaignId/invites', async (request, reply) => {
    const value = service.createInvite(requireUser(request).id, campaignId(request));
    return reply.code(201).send({ token: value });
  });
  app.post('/api/invites/accept', async (request) => ({
    campaignId: service.acceptInvite(requireUser(request).id, text(object(request.body).token)),
  }));
  app.post('/api/campaigns/:campaignId/invites/revoke', async (request) => {
    service.revokeInvite(requireUser(request).id, campaignId(request), text(object(request.body).token));
    return { ok: true };
  });
  app.get('/api/campaigns/:campaignId/notes', async (request) => ({ notes: service.listNotes(requireUser(request).id, campaignId(request)) }));
  app.post('/api/campaigns/:campaignId/notes', async (request, reply) => {
    const user = requireUser(request), body = object(request.body);
    const id = service.saveNote(user.id, campaignId(request), null, text(body.title), text(body.body), text(body.visibility) as NoteVisibility);
    return reply.code(201).send({ id });
  });
  app.put('/api/campaigns/:campaignId/notes/:noteId', async (request) => {
    const user = requireUser(request), body = object(request.body);
    service.saveNote(user.id, campaignId(request), noteId(request), text(body.title), text(body.body), text(body.visibility) as NoteVisibility);
    return { ok: true };
  });
  app.delete('/api/campaigns/:campaignId/notes/:noteId', async (request) => {
    service.deleteNote(requireUser(request).id, campaignId(request), noteId(request));
    return { ok: true };
  });
}
