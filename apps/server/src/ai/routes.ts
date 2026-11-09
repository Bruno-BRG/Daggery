import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Database from 'better-sqlite3';
import type { CampaignService } from '../campaign-service';
import { readSessionToken } from '../campaign-routes';
import { AiConflict, AiService } from './service';
import { ModelProvider, ProviderError } from './provider';
import type { SecretVault } from './vault';
import { record, text } from './validation';

export function registerAiRoutes(app: FastifyInstance, options: {
  db: Database.Database; service: CampaignService; secureCookies: boolean; vault?: SecretVault; provider?: ModelProvider;
  publish: (campaign: string, ns: string, id: string, value: unknown) => void;
  publishRoll: (campaign: string, kind: string, result: unknown, author?: string) => void;
}) {
  const ai = new AiService(options.db, options.service, options.vault, options.provider, options.publish, options.publishRoll);
  app.addHook('onClose', () => ai.close());
  const user = (request: FastifyRequest) => {
    const current = options.service.session(readSessionToken(request.headers.cookie, options.secureCookies));
    if (!current) throw new Error('Unauthorized');
    return current.id;
  };
  const campaign = (request: FastifyRequest) => (request.params as { campaignId: string }).campaignId;
  const param = (request: FastifyRequest, name: string) => text((request.params as Record<string, unknown>)[name], 120);
  const query = (request: FastifyRequest) => (request.query ?? {}) as Record<string, unknown>;
  const optional = (value: unknown) => typeof value === 'string' && value !== '' ? value : undefined;
  const handle = (fn: (request: FastifyRequest) => unknown | Promise<unknown>) => async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await fn(request);
    } catch (error) {
      if (error instanceof AiConflict) return reply.code(409).send({ error: error.message });
      if (error instanceof ProviderError) return reply.code(502).send({ error: error.message });
      throw error;
    }
  };
  app.get('/api/ai/connection', handle(request => ({ connection: ai.connection(user(request)) })));
  app.get('/api/ai/models', handle(async request => { user(request); return { models: await ai.models((request.query as { provider?: string }).provider ?? 'opencode-go') }; }));
  app.put('/api/ai/connection', handle(async request => ({ connection: await ai.saveConnection(user(request), request.body) })));
  app.delete('/api/ai/connection', handle(request => { ai.forgetConnection(user(request)); return { removed: true }; }));
  const base = '/api/campaigns/:campaignId/ai';
  app.get(base, handle(request => ai.session(user(request), campaign(request), optional(query(request).chat), optional(query(request).before))));
  app.get(base + '/options', handle(request => { ai.authorize(user(request), campaign(request)); return { classes: ai.classes }; }));
  app.put(base + '/setup', handle(request => ({ setup: ai.configure(user(request), campaign(request), request.body) })));
  app.put(base + '/enabled', handle(request => { const body = record(request.body); if (typeof body.enabled !== 'boolean') throw new Error('Invalid enabled state'); ai.pause(user(request), campaign(request), body.enabled); return { enabled: body.enabled }; }));
  app.put(base + '/memory', handle(request => { ai.memory(user(request), campaign(request), record(request.body).memory); return { saved: true }; }));
  app.post(base + '/chats', handle(request => ai.createChat(user(request), campaign(request), request.body)));
  app.post(base + '/begin', handle(request => ai.begin(user(request), campaign(request), request.body)));
  app.patch(base + '/chats/:chatId', handle(request => ai.renameChat(user(request), campaign(request), param(request, 'chatId'), request.body)));
  app.delete(base + '/chats/:chatId', handle(request => ai.deleteChat(user(request), campaign(request), param(request, 'chatId'))));
  app.post(base + '/compact', handle(request => ai.compactChat(user(request), campaign(request), request.body)));
  app.post(base + '/end', handle(request => ai.endChat(user(request), campaign(request), request.body)));
  app.post(base + '/turn', handle(request => ai.start(user(request), campaign(request), request.body)));
  app.post(base + '/stop', handle(request => { ai.cancel(user(request), campaign(request)); return { stopped: true }; }));
  app.post(base + '/retry', handle(request => ai.retry(user(request), campaign(request), text(record(request.body).turnId, 100))));
  app.post(base + '/messages/:messageId/resolve', handle(request => ai.resolve(user(request), campaign(request), param(request, 'messageId'), request.body)));
  app.get(base + '/journal', handle(request => ai.journalPage(user(request), campaign(request), query(request))));
  app.post(base + '/journal', handle(request => ({ entry: ai.addJournal(user(request), campaign(request), request.body) })));
  app.patch(base + '/journal/:entryId', handle(request => ({ entry: ai.editJournal(user(request), campaign(request), param(request, 'entryId'), request.body) })));
  app.delete(base + '/journal/:entryId', handle(request => ai.deleteJournal(user(request), campaign(request), param(request, 'entryId'))));
  return ai;
}
