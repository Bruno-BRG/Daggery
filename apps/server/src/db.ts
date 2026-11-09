import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { RollLogEntry, RollPayload } from '@daggery/shared';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rolls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  author TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL
);
`;

interface RollRow {
  id: number;
  at: string;
  author: string;
  kind: string;
  payload: string;
}

export interface RollStore {
  addRoll(author: string, payload: RollPayload): RollLogEntry;
  /** Most recent rolls, oldest first. */
  recentRolls(limit: number): RollLogEntry[];
  close(): void;
}

export function openRollStore(path: string): RollStore {
  mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  const insert = db.prepare<[string, string, string, string]>(
    'INSERT INTO rolls (at, author, kind, payload) VALUES (?, ?, ?, ?)',
  );
  const selectRecent = db.prepare<[number], RollRow>(
    'SELECT id, at, author, kind, payload FROM rolls ORDER BY id DESC LIMIT ?',
  );

  return {
    addRoll(author, payload) {
      const at = new Date().toISOString();
      const info = insert.run(at, author, payload.kind, JSON.stringify(payload.result));
      return { ...payload, id: Number(info.lastInsertRowid), at, author } as RollLogEntry;
    },
    recentRolls(limit) {
      return selectRecent
        .all(limit)
        .map(rowToEntry)
        .reverse();
    },
    close() {
      db.close();
    },
  };
}

function rowToEntry(row: RollRow): RollLogEntry {
  const result = JSON.parse(row.payload);
  const base = { id: row.id, at: row.at, author: row.author };
  return row.kind === 'duality'
    ? { ...base, kind: 'duality', result }
    : { ...base, kind: 'dice', result };
}
