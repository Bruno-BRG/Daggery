import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

/**
 * Generic shared documents: (namespace, id) -> JSON value.
 * Every feature module (sheets, map, combat...) keeps its state here and gets
 * persistence plus realtime sync for free through the 'doc:*' WebSocket messages.
 */
export interface DocRecord {
  ns: string;
  id: string;
  value: unknown;
}

export interface DocStore {
  all(): DocRecord[];
  get(ns: string, id: string): unknown;
  set(ns: string, id: string, value: unknown): void;
  delete(ns: string, id: string): void;
  close(): void;
}

export function openDocStore(path: string): DocStore {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS docs (
    ns TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, updated TEXT NOT NULL,
    PRIMARY KEY (ns, id)
  )`);
  const upsert = db.prepare(
    'INSERT INTO docs (ns, id, value, updated) VALUES (?, ?, ?, ?) ON CONFLICT(ns, id) DO UPDATE SET value = excluded.value, updated = excluded.updated',
  );
  const remove = db.prepare('DELETE FROM docs WHERE ns = ? AND id = ?');
  const selectOne = db.prepare<[string, string], { value: string }>(
    'SELECT value FROM docs WHERE ns = ? AND id = ?',
  );
  const selectAll = db.prepare<[], { ns: string; id: string; value: string }>(
    'SELECT ns, id, value FROM docs',
  );
  return {
    all: () => selectAll.all().map((r) => ({ ns: r.ns, id: r.id, value: JSON.parse(r.value) })),
    get: (ns, id) => {
      const row = selectOne.get(ns, id);
      return row ? JSON.parse(row.value) : undefined;
    },
    set: (ns, id, value) => void upsert.run(ns, id, JSON.stringify(value), new Date().toISOString()),
    delete: (ns, id) => void remove.run(ns, id),
    close: () => db.close(),
  };
}
