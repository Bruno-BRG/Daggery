import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export class SecretVault {
  constructor(private key: Buffer) { if (key.length !== 32) throw new Error('AI encryption key must be 32 bytes'); }
  seal(secret: string, userId: string): string {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(userId));
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  }
  open(value: string, userId: string): string {
    const data = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
    cipher.setAAD(Buffer.from(userId)); cipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
  }
}
export function openAiVault(dataDir: string): SecretVault {
  if (process.env.DAGGERY_AI_SECRET) return new SecretVault(Buffer.from(process.env.DAGGERY_AI_SECRET, 'base64'));
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, 'ai-keyring.key');
  if (!existsSync(path)) { try { writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 }); } catch (error) { if (!existsSync(path)) throw error; } }
  return new SecretVault(readFileSync(path));
}
