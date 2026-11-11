import { existsSync } from 'node:fs';
import { runtimePaths } from './storage';
import Database from 'better-sqlite3';
import { CampaignService } from './campaign-service';
import { CURRENT_VERSION } from './campaign-db';

// Deliberately local only: never expose this operation through HTTP.
const username = process.argv[2];
if (!username || process.argv.length !== 3) throw new Error('Uso: npm run claim-legacy -w @daggery/server -- <usuário>');
const dbPath = runtimePaths().database;
if (!existsSync(dbPath)) throw new Error('Banco de dados não encontrado');
const db = new Database(dbPath, { fileMustExist: true });
try {
  db.pragma('foreign_keys = ON');
  if (db.pragma('user_version', { simple: true }) !== CURRENT_VERSION) throw new Error('Inicie o servidor para migrar o banco antes de executar este comando');
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: string } | undefined;
  if (!user) throw new Error('Conta não encontrada');
  new CampaignService(db).claimLegacyForLocalAdmin(user.id);
  console.log('Campanha anterior associada à conta. Referências antigas de arquivos ainda exigem migração.');
} finally {
  db.close();
}
