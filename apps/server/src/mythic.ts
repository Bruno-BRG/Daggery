import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { MythicData, MythicTablesFile } from '@daggery/shared';
import type { CampaignService } from './campaign-service';
import { readSessionToken } from './campaign-routes';

/** Directory holding the oracle table data files. */
export const mythicDataDir = fileURLToPath(new URL('../../../packages/content/mythic/', import.meta.url));

const FILES = {
  oracle: 'oracle.json',
  adventureCrafter: 'adventure-crafter.json',
  locationCrafting: 'location-crafting.json',
  collectedTables: 'collected-tables.json',
} as const;

function readTables(dir: string, name: string): MythicTablesFile | null {
  try {
    return JSON.parse(readFileSync(join(dir, name), 'utf8')) as MythicTablesFile;
  } catch {
    // Missing or unreadable data is expected: the PDF extracts are not committed.
    return null;
  }
}

/**
 * Reads the four optional table files. Missing files yield `null` and
 * `available: false`; this never throws.
 *
 * Synchronous so the solo oracle can use it without awaiting. Reading is
 * cached by the caller and the files are small.
 */
export function loadMythic(dir = mythicDataDir): MythicData {
  const oracle = readTables(dir, FILES.oracle);
  const adventureCrafter = readTables(dir, FILES.adventureCrafter);
  const locationCrafting = readTables(dir, FILES.locationCrafting);
  const collectedTables = readTables(dir, FILES.collectedTables);
  const available = Boolean(oracle && adventureCrafter && locationCrafting && collectedTables);
  return { available, oracle, adventureCrafter, locationCrafting, collectedTables };
}

export function registerMythicRoutes(
  app: FastifyInstance,
  options: { service: CampaignService; secureCookies: boolean; dir?: string },
): void {
  let cached: MythicData | null = null;
  app.get('/api/mythic', async (request, reply) => {
    const user = options.service.session(readSessionToken(request.headers.cookie, options.secureCookies));
    if (!user) return reply.code(401).send({ error: 'Unauthorized' });
    if (!cached) cached = await loadMythic(options.dir);
    return cached;
  });
}
