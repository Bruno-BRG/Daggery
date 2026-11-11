import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Read-only files shipped with the application; never resolved from the data volume or cwd. */
export const bundledPaths = {
  cards: fileURLToPath(new URL('../../../packages/content/cards/', import.meta.url)),
  rules: fileURLToPath(new URL('../../../sources/rules/', import.meta.url)),
  web: fileURLToPath(new URL('../../web/dist/', import.meta.url)),
} as const;

/** Resolve at call time so environment overrides also work for local tools and isolated tests. */
export function dataDirectory(): string {
  return process.env.DAGGERY_DATA_DIR ?? fileURLToPath(new URL('../../../data/', import.meta.url));
}

/** Writable state only. Keep existing names to preserve deployed volumes and backups. */
export function runtimePaths() {
  const root = dataDirectory();
  return {
    root,
    database: process.env.DAGGERY_DB ?? join(root, 'daggery.db'),
    campaignAssets: join(root, 'campaign-assets'),
    legacyAssets: join(root, 'assets'),
    backups: join(root, 'backups'),
    rules: join(root, 'rules'),
    models: join(root, 'models'),
  };
}
