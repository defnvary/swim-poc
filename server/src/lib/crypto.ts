import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config.js';

// Envelope v1:<iv>:<tag>:<ct>, base64 parts — used for every secret column (10 §4)
const ALGO = 'aes-256-gcm';

const key = (): Buffer => {
  if (!config.secretKey) throw new Error('SWIM_SECRET_KEY is not set');
  return Buffer.from(config.secretKey, 'base64');
};

export const encrypt = (plain: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
};

export const decrypt = (envelope: string): string => {
  const [version, iv, tag, ct, ...rest] = envelope.split(':');
  // ct may legitimately be empty (empty plaintext) — only structure is validated
  if (version !== 'v1' || iv === undefined || tag === undefined || ct === undefined || rest.length > 0) {
    throw new Error('invalid crypto envelope');
  }
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
};
