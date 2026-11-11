import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { backupDatabase, CURRENT_VERSION, openCampaignDatabase } from './campaign-db';
import { CampaignService } from './campaign-service';
import { registerCampaignRoutes } from './campaign-routes';
import { registerMythicRoutes } from './mythic';
import { registerSecureGame } from './secure-game';
import { EmailAuth } from './email-auth';
import { createMailer } from './mailer';
import { openAiVault } from './ai/vault';
import { localEmbedderProvider } from './ai/local-embedder';
import { RAG_ENABLED } from './ai/embeddings';
import { registerWebApp } from './web-static';

export async function startServer(): Promise<void> {
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.DAGGERY_SERVER_PORT ?? process.env.PORT ?? 3000);
  const production = process.env.NODE_ENV === 'production';
  if (!production && !['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Non-production server must bind to loopback');
  const origin = process.env.DAGGERY_ORIGIN ?? (production ? '' : 'http://localhost:5173');
  if (!origin) throw new Error('DAGGERY_ORIGIN must specify the public HTTPS origin');
  if (production && new URL(origin).protocol !== 'https:') throw new Error('Production requires HTTPS');
  const dataDir = process.env.DAGGERY_DATA_DIR ?? fileURLToPath(new URL('../../../data/', import.meta.url));
  const dbPath = process.env.DAGGERY_DB ?? join(dataDir, 'daggery.db');
  const assetsDir = join(dataDir, 'campaign-assets');
  const cardsDir = join(dataDir, 'cards');
  mkdirSync(dirname(dbPath), { recursive: true });
  mkdirSync(cardsDir, { recursive: true });

  // Back up the live SQLite/WAL state and legacy files before the first schema migration.
  if (existsSync(dbPath)) {
    const oldDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      if (Number(oldDb.pragma('user_version', { simple: true })) < CURRENT_VERSION) {
        const backupDir = join(dataDir, 'backups', `before-campaigns-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`);
        mkdirSync(backupDir, { recursive: true });
        await backupDatabase(oldDb, join(backupDir, 'daggery.db'));
        if (existsSync(join(dataDir, 'assets'))) cpSync(join(dataDir, 'assets'), join(backupDir, 'assets'), { recursive: true, errorOnExist: true, force: false });
        console.log(`Legacy backup saved to ${backupDir}`);
      }
    } finally { oldDb.close(); }
  }
  const db = openCampaignDatabase(dbPath);
  const service = new CampaignService(db);
  const app = Fastify({ logger: true });
  app.addHook('onClose', async () => db.close());
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
  await app.register(fastifyStatic, { root: cardsDir, prefix: '/cards/', decorateReply: false });
  const allowRegistration = process.env.DAGGERY_ALLOW_REGISTRATION === '1' || (!production && process.env.DAGGERY_ALLOW_REGISTRATION !== '0');
  const mailer = createMailer(process.env);
  const emailAuth = mailer ? new EmailAuth(db, mailer, allowRegistration) : undefined;
  await registerCampaignRoutes(app, { service, origin, secureCookies: production, allowRegistration, emailAuth });
  registerMythicRoutes(app, { service, secureCookies: production });
  // Semantic retrieval is local and optional. The provider is lazy: no model is loaded (or
  // downloaded) until a turn or a background backfill asks for it. DAGGERY_RAG=off disables it.
  const aiEmbedder = RAG_ENABLED() ? localEmbedderProvider({ modelsDir: join(dataDir, 'models') }) : undefined;
  await registerSecureGame(app, { db, service, origin, secureCookies: production, assetsDir, aiVault: openAiVault(dataDir), aiEmbedder });
  app.get('/health', async () => ({ ok: true }));
  if (production && !(await registerWebApp(app, fileURLToPath(new URL('../../web/dist/', import.meta.url))))) throw new Error('The web app is not built. Run npm run build -w @daggery/web before starting in production.');
  await app.listen({ port, host });
}
