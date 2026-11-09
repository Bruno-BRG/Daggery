import { createReadStream, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { imageSize } from 'image-size';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import type { WebSocket } from 'ws';
import { CampaignService, type CampaignRole } from './campaign-service';
import { readSessionToken } from './campaign-routes';
import { canReadDocument, canWriteDocument, hasFeature, isRealtimeDocument } from '@daggery/shared';
import { registerSoloRoutes } from './solo';
import { registerAiRoutes } from './ai/routes';
import type { SecretVault } from './ai/vault';
import type { ModelProvider } from './ai/provider';

interface Options { db: Database.Database; service: CampaignService; origin: string; secureCookies: boolean; assetsDir: string; aiVault?: SecretVault; aiProvider?: ModelProvider }
interface Peer { socket: WebSocket; session: string; userId: string; campaignId: string }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const params = (request: FastifyRequest): Record<string, string> => request.params as Record<string, string>;

export async function registerSecureGame(app: FastifyInstance, options: Options): Promise<void> {
  const { db, service, origin, secureCookies, assetsDir } = options;
  mkdirSync(assetsDir, { recursive: true });
  const peers = new Set<Peer>();
  const userFor = (request: FastifyRequest) => service.session(readSessionToken(request.headers.cookie, secureCookies));
  const auth = (request: FastifyRequest, campaignId: string) => {
    const user = userFor(request);
    if (!user) throw new Error('Unauthorized');
    const role = service.requireMember(user.id, campaignId);
    return { user, role };
  };
  const currentRole = (peer: Peer): CampaignRole | null => {
    const user = service.session(peer.session);
    return user?.id === peer.userId ? service.role(user.id, peer.campaignId) : null;
  };
  const broadcast = (campaignId: string, message: unknown, ns?: string, id?: string) => {
    const data = JSON.stringify(message);
    for (const peer of peers) {
      if (peer.campaignId !== campaignId) continue;
      const role = currentRole(peer);
      if (!role) { peer.socket.close(1008, 'Access revoked'); continue; }
      if ((!ns || canReadDocument(service.configuration(campaignId), role, ns, id ?? '')) && peer.socket.readyState === 1) peer.socket.send(data);
    }
  };
  app.get('/ws', {
    websocket: true,
    preValidation: async (request, reply) => {
      const query = request.query as { campaign?: string };
      if (request.headers.origin !== origin || !query.campaign) return reply.code(403).send({ error: 'Forbidden' });
      try { auth(request, query.campaign); } catch { return reply.code(403).send({ error: 'Forbidden' }); }
    },
  }, (socket, request) => {
    const campaignId = (request.query as { campaign: string }).campaign;
    const session = readSessionToken(request.headers.cookie, secureCookies);
    const user = service.session(session);
    if (!user) { socket.close(1008); return; }
    const role = service.role(user.id, campaignId);
    if (!role) { socket.close(1008); return; }
    const peer: Peer = { socket, session, userId: user.id, campaignId };
    peers.add(peer);
    const rolls = db.prepare('SELECT id, at, author, kind, payload FROM campaign_rolls WHERE campaign_id = ? ORDER BY id DESC LIMIT 50').all(campaignId) as { id:number; at:string; author:string; kind:string; payload:string }[];
    socket.send(JSON.stringify({ type: 'hello', rolls: rolls.reverse().map(({ payload, ...row }) => ({ ...row, result: JSON.parse(payload) })) }));
    const docs = db.prepare('SELECT ns, id, value FROM campaign_docs WHERE campaign_id = ?').all(campaignId) as { ns:string; id:string; value:string }[];
    const configuration = service.configuration(campaignId);
    socket.send(JSON.stringify({ type: 'docs:snapshot', docs: docs.filter(d => isRealtimeDocument(configuration, d.ns, d.id) && canReadDocument(configuration, role, d.ns, d.id)).map(d => ({ ...d, value: JSON.parse(d.value) })) }));
    socket.on('close', () => peers.delete(peer));
    socket.on('message', raw => {
      try {
        const activeRole = currentRole(peer);
        if (!activeRole) { socket.close(1008, 'Access revoked'); return; }
        const msg: unknown = JSON.parse(raw.toString());
        if (!record(msg) || typeof msg.type !== 'string') throw new Error('Invalid message');
        if (msg.type === 'roll') {
          if (msg.kind === 'duality' && !hasFeature(service.configuration(campaignId), 'daggerheart.duality')) throw new Error('Forbidden');
          if (!record(msg.result) || typeof msg.result.total !== 'number' || !Number.isFinite(msg.result.total) || !['dice','duality'].includes(String(msg.kind))) throw new Error('Invalid roll');
          if ((msg.kind === 'dice' && typeof msg.result.notation !== 'string') || (msg.kind === 'duality' && typeof msg.result.outcome !== 'string')) throw new Error('Invalid roll');
          if (msg.clientRollId !== undefined && (typeof msg.clientRollId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(msg.clientRollId))) throw new Error('Invalid roll ID');
          const at = new Date().toISOString();
          const info = db.prepare('INSERT INTO campaign_rolls(campaign_id, at, author, kind, payload) VALUES (?, ?, ?, ?, ?)').run(campaignId, at, user.username, msg.kind, JSON.stringify(msg.result));
          broadcast(campaignId, { type: 'roll', entry: { id: Number(info.lastInsertRowid), at, author: user.username, kind: msg.kind, result: msg.result, ...(msg.clientRollId ? { clientRollId: msg.clientRollId } : {}) } });
          return;
        }
        if (msg.type === 'fear:add') {
          if (!hasFeature(service.configuration(campaignId), 'daggerheart.duality')) throw new Error('Forbidden');
          const delta = msg.delta;
          if (typeof delta !== 'number' || !Number.isInteger(delta) || Math.abs(delta) > 12 || (activeRole !== 'gm' && delta < 0)) throw new Error('Invalid fear');
          const row = db.prepare("SELECT value FROM campaign_docs WHERE campaign_id = ? AND ns = 'combat' AND id = 'fear'").get(campaignId) as { value: string } | undefined;
          const existing: unknown = row ? JSON.parse(row.value) : null;
          const old = record(existing) && typeof existing.value === 'number' ? existing.value : 0;
          const value = { kind: 'fear', value: Math.min(12, Math.max(0, old + delta)) };
          db.prepare(`INSERT INTO campaign_docs(campaign_id, ns, id, value, updated) VALUES (?, 'combat', 'fear', ?, ?)
            ON CONFLICT(campaign_id,ns,id) DO UPDATE SET value=excluded.value, updated=excluded.updated`).run(campaignId, JSON.stringify(value), new Date().toISOString());
          broadcast(campaignId, { type: 'doc:set', ns: 'combat', id: 'fear', value }, 'combat', 'fear');
          return;
        }
        if (msg.type === 'doc:set' || msg.type === 'doc:delete') {
          const ns = msg.ns, id = msg.id;
          if (typeof ns !== 'string' || typeof id !== 'string' || !id || id.length > 120 || !canWriteDocument(service.configuration(campaignId), activeRole, ns, id)) throw new Error('Forbidden');
          if (msg.type === 'doc:set') {
            if (!record(msg.value)) throw new Error('Invalid document');
            db.prepare(`INSERT INTO campaign_docs(campaign_id, ns, id, value, updated) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(campaign_id,ns,id) DO UPDATE SET value=excluded.value, updated=excluded.updated`).run(campaignId, ns, id, JSON.stringify(msg.value), new Date().toISOString());
            broadcast(campaignId, { type: 'doc:set', ns, id, value: msg.value }, ns, id);
          } else {
            db.prepare('DELETE FROM campaign_docs WHERE campaign_id = ? AND ns = ? AND id = ?').run(campaignId, ns, id);
            broadcast(campaignId, { type: 'doc:delete', ns, id }, ns, id);
          }
          return;
        }
        throw new Error('Unsupported message');
      } catch { socket.send(JSON.stringify({ type: 'error', message: 'Alteração não autorizada ou inválida' })); }
    });
  });

  registerSoloRoutes(app, { db, service, secureCookies, publish: (campaign, ns, id, value) => broadcast(campaign, { type: 'doc:set', ns, id, value }, ns, id) });
  registerAiRoutes(app, { db, service, secureCookies, vault: options.aiVault, provider: options.aiProvider,
    publish: (campaign, ns, id, value) => broadcast(campaign, { type: 'doc:set', ns, id, value }, ns, id),
    publishRoll: (campaign, kind, result, author = 'AI GM') => {
      const at = new Date().toISOString();
      const row = db.prepare('INSERT INTO campaign_rolls(campaign_id,at,author,kind,payload) VALUES (?,?,?,?,?)').run(campaign, at, author, kind, JSON.stringify(result));
      broadcast(campaign, { type: 'roll', entry: { id: Number(row.lastInsertRowid), at, author, kind, result } });
    },
  });
  const upload = (characterImage: boolean) => async (request: FastifyRequest, reply: FastifyReply) => {
    const campaignId = params(request).campaignId!;
    const { user, role } = auth(request, campaignId);
    if (characterImage ? !canWriteDocument(service.configuration(campaignId), role, 'sheets', 'character') : role !== 'gm') throw new Error('Forbidden');
    const part = await request.file();
    if (!part) return reply.code(400).send({ error: 'Missing file' });
    const data = await part.toBuffer();
    if (characterImage && data.length > 10 * 1024 * 1024) return reply.code(413).send({ error: 'Character images must be 10 MB or smaller' });
    const type = await fileTypeFromBuffer(data);
    if (!type || !['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(type.mime)) return reply.code(400).send({ error: 'Unsupported file' });
    if (characterImage && !type.mime.startsWith('image/')) return reply.code(400).send({ error: 'Choose a PNG, JPEG, or WebP image' });
    if (type.mime.startsWith('image/')) {
      try {
        const dimensions = imageSize(data);
        if (!dimensions.width || !dimensions.height || dimensions.width > 8192 || dimensions.height > 8192 || dimensions.width * dimensions.height > 32_000_000) throw new Error('Image too large');
      } catch { return reply.code(400).send({ error: 'Invalid image dimensions' }); }
    }
    const id = randomUUID(), storageName = `${randomUUID()}.${type.ext}`;
    await writeFile(join(assetsDir, storageName), data, { flag: 'wx' });
    try {
      db.prepare(`INSERT INTO campaign_assets(id,campaign_id,uploaded_by,name,category,media_type,size,storage_name,visibility,created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, campaignId, user.id, part.filename.slice(0, 200), characterImage ? 'character' : type.mime === 'application/pdf' ? 'document' : 'image', type.mime, data.length, storageName, characterImage ? 'shared' : 'gm', new Date().toISOString());
    } catch (error) {
      const { unlink } = await import('node:fs/promises');
      await unlink(join(assetsDir, storageName));
      throw error;
    }
    return reply.code(201).send({ id, url: `/api/campaigns/${campaignId}/assets/${id}` });
  };
  app.post('/api/campaigns/:campaignId/assets', upload(false));
  app.post('/api/campaigns/:campaignId/character-images', upload(true));
  app.get('/api/campaigns/:campaignId/assets', async request => {
    const campaignId = params(request).campaignId!;
    const { role } = auth(request, campaignId);
    return { assets: db.prepare(`SELECT id,name,category,media_type AS mediaType,size,created_at AS createdAt FROM campaign_assets
      WHERE campaign_id = ? AND (? = 'gm' OR visibility = 'shared') ORDER BY created_at DESC`).all(campaignId, role) };
  });
  app.get('/api/campaigns/:campaignId/assets/:assetId', async (request, reply) => {
    const campaignId = params(request).campaignId!;
    const { role } = auth(request, campaignId);
    const asset = db.prepare('SELECT storage_name AS storageName, media_type AS mediaType, visibility FROM campaign_assets WHERE campaign_id = ? AND id = ?').get(campaignId, params(request).assetId) as { storageName:string; mediaType:string; visibility:string } | undefined;
    if (!asset || (asset.visibility === 'gm' && role !== 'gm')) return reply.code(404).send({ error: 'Not found' });
    reply.header('Content-Type', asset.mediaType).header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'private, no-store');
    if (asset.mediaType === 'application/pdf') reply.header('Content-Disposition', request.query && (request.query as { inline?: string }).inline === '1' ? 'inline; filename="reference.pdf"' : 'attachment');
    return reply.send(createReadStream(join(assetsDir, asset.storageName)));
  });
}
