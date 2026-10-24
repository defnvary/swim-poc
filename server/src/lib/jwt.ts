import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { config } from '../config.js';

export type UserRole = 'admin' | 'member' | 'viewer';
export interface TokenUser {
  id: string;
  role: UserRole;
  username: string;
}

const secret = (): Uint8Array => {
  if (!config.jwtSecret) throw new Error('SWIM_JWT_SECRET is not set');
  return new Uint8Array(Buffer.from(config.jwtSecret, 'base64'));
};

// HS256, 15 min TTL, claims sub/role/username (06 §1)
export const signAccessToken = (user: TokenUser): Promise<string> =>
  new SignJWT({ role: user.role, username: user.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret());

export const verifyAccessToken = async (token: string): Promise<JWTPayload> => {
  const { payload } = await jwtVerify(token, secret());
  return payload;
};

// Refresh tokens: random 256-bit, stored SHA-256-hashed (05 §3)
export const newRefreshToken = (): string => randomBytes(32).toString('base64url');

export const hashRefreshToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
