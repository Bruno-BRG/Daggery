import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DUALITY_MAX_FEAR, hasFeature, initialSoloState, resolveSoloOracle, resolveSoloScene, rollDie, soloPrompt, SOLO_ADVANCEMENT, SOLO_CLOCK_LIMIT, SOLO_EXTRA_TABLES, SOLO_RULES_VERSION, SOLO_THEMES, SOLO_TRACKER_LIMIT, SOLO_WORLD_MOVES, type Rng, type SoloActionOutcome, type SoloEntry, type SoloResult, type SoloSnapshot, type SoloState, type SoloTone, type SoloTrackerItem } from '@daggery/shared';
import { openLines, rollDuality } from './solo-duality';
import type { CampaignService } from './campaign-service';
import { readSessionToken } from './campaign-routes';

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid solo data');
  return value as Record<string, unknown>;
};
const string = (value: unknown, max = 2000): string => {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid solo text');
  return value;
};
const integer = (value: unknown, min: number, max: number) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error('Invalid solo number');
  return value;
};
export class SoloConflict extends Error { constructor() { super('Preparation changed in another window. Reload the latest version before saving.'); } }
export class SoloService {
  constructor(
    private db: Database.Database,
    private campaigns: CampaignService,
    private publish: (campaignId: string, ns: string, id: string, value: unknown) => void = () => {},
    private rng: Rng = Math.random,
  ) {}
  authorize(userId: string, campaignId: string) {
    this.campaigns.requireGm(userId, campaignId);
    if (!hasFeature(this.campaigns.configuration(campaignId), 'daggerheart.solo')) throw new Error('Forbidden');
  }
  private read<T>(campaign: string, ns: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM campaign_docs WHERE campaign_id = ? AND ns = ? AND id = ?').get(campaign, ns, id) as { value: string } | undefined;
    return row ? JSON.parse(row.value) as T : undefined;
  }
  private write(campaign: string, ns: string, id: string, value: unknown) {
    this.db.prepare(`INSERT INTO campaign_docs(campaign_id,ns,id,value,updated) VALUES (?,?,?,?,?)
      ON CONFLICT(campaign_id,ns,id) DO UPDATE SET value=excluded.value,updated=excluded.updated`).run(campaign, ns, id, JSON.stringify(value), new Date().toISOString());
  }
  snapshot(userId: string, campaign: string): SoloSnapshot {
    this.authorize(userId, campaign);
    return { state: this.read<SoloState>(campaign, 'solo', 'state') ?? initialSoloState(), ...this.entries(userId, campaign) };
  }
  entries(userId: string, campaign: string, before = '') {
    this.authorize(userId, campaign);
    string(before, 160);
    const rows = this.db.prepare(`SELECT value, json_extract(value,'$.at') || '/' || json_extract(value,'$.id') AS cursor
      FROM campaign_docs WHERE campaign_id = ? AND ns = 'solo' AND id LIKE 'entry:%'
      AND (? = '' OR json_extract(value,'$.at') || '/' || json_extract(value,'$.id') < ?)
      ORDER BY cursor DESC LIMIT 201`).all(campaign, before, before) as { value: string; cursor: string }[];
    return { entries: rows.slice(0, 200).map(row => JSON.parse(row.value) as SoloEntry), nextCursor: rows.length > 200 ? rows[199]!.cursor : null };
  }
  private change(userId: string, campaign: string, revision: unknown, apply: (state: SoloState) => void): SoloState {
    this.authorize(userId, campaign);
    const result = this.db.transaction(() => {
      const state = this.read<SoloState>(campaign, 'solo', 'state') ?? initialSoloState();
      if (revision !== state.revision) throw new SoloConflict();
      apply(state); state.revision++;
      this.write(campaign, 'solo', 'state', state);
      return state;
    })();
    this.publish(campaign, 'solo', 'state', result);
    return result;
  }
  save(userId: string, campaign: string, value: unknown) {
    const input = object(value);
    return this.change(userId, campaign, input.revision, state => {
      const scene = object(input.scene), countdowns = object(input.countdowns);
      state.scene = { title: string(scene.title, 200), goal: string(scene.goal), expected: string(scene.expected), signature: string(scene.signature, 500), signatureCost: integer(scene.signatureCost, 1, 12) };
      if (!Array.isArray(input.pool) || input.pool.length !== 12) throw new Error('Invalid campaign pool');
      state.pool = input.pool.map(entry => string(entry, 200).trim());
      for (const entry of new Set(state.pool.filter(item => item.trim()))) {
        if (state.pool.filter(item => item.trim() === entry.trim()).length > 2) throw new Error('Invalid pool: use at most two slots per entry');
      }
      const theme = string(input.theme, 40), secondaryTheme = string(input.secondaryTheme, 40);
      if (!SOLO_THEMES.some(item => item.id === theme) || secondaryTheme && !SOLO_THEMES.some(item => item.id === secondaryTheme)) throw new Error('Invalid theme');
      state.theme = theme; state.secondaryTheme = secondaryTheme;
      state.countdowns = {
        progressName: string(countdowns.progressName, 200), consequenceName: string(countdowns.consequenceName, 200),
        progressStart: integer(countdowns.progressStart, 1, 20), consequenceStart: integer(countdowns.consequenceStart, 1, 20),
        progress: integer(countdowns.progress, 0, Number(countdowns.progressStart)), consequence: integer(countdowns.consequence, 0, Number(countdowns.consequenceStart)),
      };
      if (!Array.isArray(input.companions) || input.companions.length > 1) throw new Error('Invalid companion list');
      state.companions = input.companions.map(value => {
        const companion = object(value);
        return { id: string(companion.id, 80), name: string(companion.name, 100), motive: string(companion.motive, 500), bond: string(companion.bond, 500), specialty: string(companion.specialty, 200), tier: integer(companion.tier, 1, 4), hpMarked: integer(companion.hpMarked, 0, 3), stressMarked: integer(companion.stressMarked, 0, 3) };
      });
    });
  }
  /** Saves the parts of the state the solo tracker edits. Fields left out keep their value. */
  track(userId: string, campaign: string, value: unknown) {
    const input = object(value);
    const list = (raw: unknown): SoloTrackerItem[] => {
      if (!Array.isArray(raw) || raw.length > 60) throw new Error('Invalid tracker list');
      return raw.map(entry => {
        const item = object(entry), id = string(item.id, 80), name = string(item.name, 120).trim();
        if (!/^[a-zA-Z0-9-]{1,80}$/.test(id) || !name || typeof item.done !== 'boolean') throw new Error('Invalid tracker item');
        return { id, name, note: string(item.note ?? '', 500), done: item.done };
      });
    };
    return this.change(userId, campaign, input.revision, state => {
      if (input.scene !== undefined) {
        const scene = object(input.scene);
        state.scene = { ...state.scene, title: string(scene.title, 200), goal: string(scene.goal ?? state.scene.goal), expected: string(scene.expected) };
      }
      if (input.threads !== undefined) state.threads = list(input.threads);
      if (input.characters !== undefined) state.characters = list(input.characters);
      if (input.clocks !== undefined) {
        if (!Array.isArray(input.clocks) || input.clocks.length > SOLO_CLOCK_LIMIT) throw new Error('Invalid countdowns');
        state.clocks = input.clocks.map(entry => {
          const item = object(entry), id = string(item.id, 80), name = string(item.name, 120).trim(), start = integer(item.start, 1, 12);
          if (!/^[a-zA-Z0-9-]{1,80}$/.test(id) || !name) throw new Error('Invalid countdown');
          return { id, name, start, current: integer(item.current, 0, start) };
        });
      }
      // A d12 picks from a List, so it holds at most twelve open lines.
      for (const field of ['threads', 'characters'] as const) {
        if (openLines(state, field).length > SOLO_TRACKER_LIMIT) throw new Error(`Invalid list: at most ${SOLO_TRACKER_LIMIT} open lines`);
      }
    });
  }
  roll(userId: string, campaign: string, value: unknown): SoloEntry {
    this.authorize(userId, campaign);
    const input = object(value), id = string(input.requestId, 80), kind = string(input.kind, 30);
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('Invalid request ID');
    const previous = this.read<SoloEntry>(campaign, 'solo', `entry:${id}`);
    if (previous) return previous;
    let question = string(input.question ?? '', 2000);
    const state = this.read<SoloState>(campaign, 'solo', 'state') ?? initialSoloState();
    let result: SoloResult;
    let fearAfter: { kind: 'fear'; value: number } | undefined;
    if (kind === 'oracle') {
      if (!question.trim()) throw new Error('Invalid question');
      result = resolveSoloOracle(rollDie(12), rollDie(12), string(input.likelihood, 30));
    } else if (kind === 'scene') {
      result = resolveSoloScene(rollDie(12), rollDie(12), rollDie(12));
    } else if (kind === 'prompt') {
      const tone = string(input.tone ?? 'neutral', 20) as SoloTone;
      if (!['hope', 'fear', 'revelation', 'neutral'].includes(tone)) throw new Error('Invalid tone');
      result = soloPrompt({ theme: state.theme, secondaryTheme: state.secondaryTheme, pool: state.pool, anchor: string(input.anchor ?? '', 200), tone });
    } else if (kind === 'response') {
      const die = rollDie(12);
      result = { title: SOLO_WORLD_MOVES[die - 1]!, detail: 'Use an established motive or predeclared risk. Apply actual attack/hazard rules; this prompt itself deals no damage.', tone: 'neutral', total: die };
    } else if (kind === 'table') {
      const table = SOLO_EXTRA_TABLES.find(table => table.id === input.table);
      if (!table) throw new Error('Invalid prompt table');
      const die = rollDie(12);
      result = { title: table.entries[die - 1]!, detail: `${table.name} · interpret in context. This prompt grants no new abilities, damage, or extra actions.`, total: die, tone: 'neutral' };
    } else if (kind.startsWith('duality-')) {
      const pool = this.read<{ kind: string; value: number }>(campaign, 'combat', 'fear');
      const fear = Math.min(DUALITY_MAX_FEAR, Math.max(0, Math.trunc(Number(pool?.value) || 0)));
      const outcome = rollDuality(kind, { state, fear, rng: this.rng, input, question });
      result = outcome.result;
      question = outcome.question ?? question;
      if (outcome.fearSpent > 0) fearAfter = { kind: 'fear', value: fear - outcome.fearSpent };
    } else if (kind === 'journal') {
      if (!question.trim()) throw new Error('Invalid journal entry');
      result = { title: 'Journal note', detail: '', tone: 'neutral' };
    } else throw new Error('Invalid solo roll type');
    const entry: SoloEntry = { id, at: new Date().toISOString(), kind, question, result, interpretation: kind === 'journal' ? question : '', accepted: kind === 'journal', rulesVersion: SOLO_RULES_VERSION };
    // A roll that spends Fear saves the pool and the entry together.
    this.db.transaction(() => {
      if (fearAfter) this.write(campaign, 'combat', 'fear', fearAfter);
      this.write(campaign, 'solo', `entry:${id}`, entry);
    })();
    if (fearAfter) this.publish(campaign, 'combat', 'fear', fearAfter);
    return entry;
  }
  /** The current state, for a client to resync after a roll. */
  current(userId: string, campaign: string): SoloState {
    this.authorize(userId, campaign);
    return this.read<SoloState>(campaign, 'solo', 'state') ?? initialSoloState();
  }
  accept(userId: string, campaign: string, id: string, interpretation: unknown) {
    this.authorize(userId, campaign);
    const text = string(interpretation, 6000);
    if (!text.trim()) throw new Error('Invalid interpretation');
    const entry = this.read<SoloEntry>(campaign, 'solo', `entry:${id}`);
    if (!entry) throw new Error('Invalid journal entry');
    entry.interpretation = text; entry.accepted = true;
    this.write(campaign, 'solo', `entry:${id}`, entry);
    return entry;
  }
  command(userId: string, campaign: string, value: unknown) {
    const input = object(value);
    let changedFear: { kind: string; value: number } | undefined;
    let changedHero: { id: string; value: Record<string, unknown> } | undefined;
    let detail = '';
    const state = this.change(userId, campaign, input.revision, state => {
      if (input.command === 'next-beat') {
        state.beat = { id: randomUUID(), contributions: [], fearSpent: false, outcomeApplied: false };
        detail = 'New action beat. Oracle and prompt rolls never reset this tracker.';
      } else if (input.command === 'end-scene') {
        state.sceneNumber = (state.sceneNumber ?? 0) + 1;
        state.scene = { ...state.scene, title: '', expected: '' };
        detail = `Scene ${state.sceneNumber} ended. Update your lists: add the Threads and NPCs that mattered, cross off what is resolved.`;
      } else if (input.command === 'countdown') {
        if (state.beat.outcomeApplied) throw new Error('Invalid action: this beat already advanced the countdowns');
        const outcome = string(input.outcome, 30) as SoloActionOutcome;
        const advancement = SOLO_ADVANCEMENT[outcome];
        if (!advancement) throw new Error('Invalid action outcome');
        if (state.countdowns.progressName) state.countdowns.progress = Math.max(0, state.countdowns.progress - advancement[0]);
        if (state.countdowns.consequenceName) state.countdowns.consequence = Math.max(0, state.countdowns.consequence - advancement[1]);
        state.beat.outcomeApplied = true;
        detail = 'Relevant dynamic countdowns advanced once. Resolve any completion without charging its risk twice.';
      } else if (input.command === 'spend-fear') {
        if (state.beat.fearSpent) throw new Error('Invalid action: Fear was already spent in this beat');
        const amount = integer(input.amount, 1, 12);
        const fear = this.read<{ kind: string; value: number }>(campaign, 'combat', 'fear') ?? { kind: 'fear', value: 0 };
        if (fear.value < Number(this.campaigns.configuration(campaign).options.fearThreshold)) throw new Error('Invalid action: Fear is below the configured pacing threshold');
        if (fear.value < amount) throw new Error('Invalid action: not enough Fear');
        changedFear = { kind: 'fear', value: fear.value - amount };
        this.write(campaign, 'combat', 'fear', changedFear);
        state.beat.fearSpent = true;
        detail = `Spent ${amount} Fear. Resolve the chosen legal feature or setup once.`;
      } else if (input.command === 'consume-assist') {
        if (this.campaigns.configuration(campaign).options.partyMode !== 'companion') throw new Error('Invalid companion mode');
        if (!state.beat.assistedHeroId || state.beat.assistedHeroId !== input.heroId || state.beat.assistConsumed) throw new Error('Invalid assistance: none prepared for this hero');
        state.beat.assistConsumed = true;
        detail = 'Prepared companion assistance applied to the hero’s action.';
      } else if (input.command === 'companion' || input.command === 'rest-companion') {
        if (this.campaigns.configuration(campaign).options.partyMode !== 'companion') throw new Error('Invalid companion mode');
        const companion = state.companions.find(item => item.id === input.companionId);
        if (!companion) throw new Error('Invalid companion');
        if (input.command === 'rest-companion') {
          if (input.rest !== 'short' && input.rest !== 'long') throw new Error('Invalid rest');
          const recovery = input.rest === 'long' ? 3 : 1;
          companion.hpMarked = Math.max(0, companion.hpMarked - recovery); companion.stressMarked = Math.max(0, companion.stressMarked - recovery);
          detail = 'Companion recovered. Apply the hero’s completed rest and its Fear gain on the character sheet.';
        } else {
          if (companion.hpMarked >= 3 || companion.stressMarked >= 3 || state.beat.contributions.includes(companion.id)) throw new Error('Invalid contribution: companion is exhausted, incapacitated, or already contributed');
          if (!['assist', 'strike', 'cover'].includes(String(input.contribution))) throw new Error('Invalid contribution');
          if (input.confirmed !== true) throw new Error('Invalid contribution: confirm positioning and costs');
          if (input.contribution === 'assist') {
            const heroId = string(input.heroId, 120);
            const hero = this.read<Record<string, unknown>>(campaign, 'sheets', heroId);
            if (!hero || typeof hero.hope !== 'number' || hero.hope < 1) throw new Error('Invalid assistance: select a hero with at least 1 Hope');
            changedHero = { id: heroId, value: { ...hero, hope: hero.hope - 1, updatedAt: new Date().toISOString() } };
            this.write(campaign, 'sheets', heroId, changedHero.value);
            state.beat.assistedHeroId = heroId; state.beat.assistConsumed = false;
          }
          companion.stressMarked++; state.beat.contributions.push(companion.id);
          detail = input.contribution === 'assist' ? 'Assist prepared: 1 hero Hope and 1 companion Stress paid. The character sheet will apply advantage to the next action automatically; it cancels disadvantage and does not stack with existing advantage.'
            : input.contribution === 'strike' ? `Strike together: add ${rollDie(6)} damage after the hero’s successful attack and critical calculation, before applying thresholds.`
              : 'Cover: reduce the HP the hero would mark by 1 (minimum 0), after Armor. Direct damage cannot be covered.';
        }
      } else throw new Error('Invalid solo command');
      const entry: SoloEntry = { id: randomUUID(), at: new Date().toISOString(), kind: 'procedure', question: String(input.command), result: { title: detail, detail: '', tone: 'neutral' }, interpretation: detail, accepted: true, rulesVersion: SOLO_RULES_VERSION };
      this.write(campaign, 'solo', `entry:${entry.id}`, entry);
    });
    if (changedFear) this.publish(campaign, 'combat', 'fear', changedFear);
    if (changedHero) this.publish(campaign, 'sheets', changedHero.id, changedHero.value);
    return { state, detail };
  }
}

export function registerSoloRoutes(app: FastifyInstance, options: { db: Database.Database; service: CampaignService; secureCookies: boolean; publish: (campaign: string, ns: string, id: string, value: unknown) => void }) {
  const solo = new SoloService(options.db, options.service, options.publish);
  const ids = (request: FastifyRequest) => {
    const user = options.service.session(readSessionToken(request.headers.cookie, options.secureCookies));
    if (!user) throw new Error('Unauthorized');
    return { user: user.id, campaign: (request.params as { campaignId: string }).campaignId };
  };
  const base = '/api/campaigns/:campaignId/solo';
  app.get(base, request => { const id = ids(request); return solo.snapshot(id.user, id.campaign); });
  app.get(`${base}/entries`, request => { const id = ids(request); return solo.entries(id.user, id.campaign, (request.query as { before?: string }).before); });
  app.put(`${base}/state`, (request, reply) => {
    const id = ids(request);
    try { return { state: solo.save(id.user, id.campaign, request.body) }; }
    catch (error) { if (error instanceof SoloConflict) return reply.code(409).send({ error: error.message }); throw error; }
  });
  app.put(`${base}/tracker`, (request, reply) => {
    const id = ids(request);
    try { return { state: solo.track(id.user, id.campaign, request.body) }; }
    catch (error) { if (error instanceof SoloConflict) return reply.code(409).send({ error: error.message }); throw error; }
  });
  app.post(`${base}/roll`, request => { const id = ids(request); const entry = solo.roll(id.user, id.campaign, request.body); return { entry, state: solo.current(id.user, id.campaign) }; });
  app.put(`${base}/entries/:entryId`, request => { const id = ids(request); return { entry: solo.accept(id.user, id.campaign, (request.params as { entryId: string }).entryId, object(request.body).interpretation) }; });
  app.post(`${base}/command`, (request, reply) => {
    const id = ids(request);
    try { return solo.command(id.user, id.campaign, request.body); }
    catch (error) { if (error instanceof SoloConflict) return reply.code(409).send({ error: error.message }); throw error; }
  });
}
