import { randomUUID } from 'node:crypto';
import { Router, type Response } from 'express';
import type { Model, ModelStatic } from 'sequelize';
import argon2 from 'argon2';
import { z } from 'zod';
import { db } from '../db/sequelize.js';
import { hashRefreshToken, newRefreshToken, signAccessToken } from '../lib/jwt.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';
import { authLimiter } from '../middleware/rate-limit.js';
import { event } from '../services/audit.js';

export const authRouter = Router();

// sequelize v6 define() is untyped (05 §1 listings are verbatim); typed handles per 05 §1 shapes
type Role = 'admin' | 'member' | 'viewer';
interface UserRow {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
interface TokenRow {
  id: string;
  familyId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}
interface UserInstance extends Model<UserRow, Partial<UserRow> & { username: string; passwordHash: string }> {
  id: string; username: string; passwordHash: string; role: Role; active: boolean; createdAt: Date; updatedAt: Date;
}
interface TokenInstance extends Model<TokenRow, Partial<TokenRow> & { familyId: string; userId: string; tokenHash: string; expiresAt: Date }> {
  id: string; familyId: string; userId: string; tokenHash: string; expiresAt: Date; revokedAt: Date | null; createdAt: Date;
}
const Users = db.User as unknown as ModelStatic<UserInstance>;
const Tokens = db.RefreshToken as unknown as ModelStatic<TokenInstance>;

const COOKIE = 'swim_refresh';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const cookieOpts = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
  path: '/api/auth',
  maxAge: WEEK_MS,
};

const readRefreshCookie = (header: string | undefined): string | undefined =>
  header?.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);

// 05 §3: id = familyId = uuid() on the first row; successors share the familyId
const issueSession = async (res: Response, userId: string, familyId: string) => {
  const raw = newRefreshToken();
  await Tokens.create({
    id: randomUUID(),
    familyId,
    userId,
    tokenHash: hashRefreshToken(raw),
    expiresAt: new Date(Date.now() + WEEK_MS),
  });
  res.cookie(COOKIE, raw, cookieOpts);
  return raw;
};

const publicUser = (u: UserRow) => ({
  id: u.id,
  username: u.username,
  role: u.role,
  createdAt: u.createdAt.toISOString(),
});

const credentialsSchema = z
  .object({ username: z.string().min(1), password: z.string().min(1) })
  .strict();

// POST /setup — public only while zero users exist (06 §3)
authRouter.post('/setup', authLimiter, async (req, res) => {
  const body = z
    .object({ username: z.string().min(1), password: z.string().min(10) })
    .strict()
    .parse(req.body);
  if ((await Users.count()) > 0) throw new HttpError(409, 'conflict', 'setup already completed');
  const user = await Users.create({
    username: body.username,
    passwordHash: await argon2.hash(body.password),
    role: 'admin',
  });
  await issueSession(res, user.id, randomUUID());
  await event('setup.completed', { userId: user.id, targetType: 'user', targetId: user.id });
  const accessToken = await signAccessToken({ id: user.id, role: user.role, username: user.username });
  res.status(201).json({ accessToken, user: publicUser(user) });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const body = credentialsSchema.parse(req.body);
  const user = await Users.findOne({ where: { username: body.username } });
  const ok = user ? await argon2.verify(user.passwordHash, body.password) : false;
  if (!user || !ok) {
    await event('auth.login_failed', { userId: user?.id ?? null, targetType: 'user', targetId: user?.id ?? null }, { username: body.username });
    throw new HttpError(401, 'invalid_credentials', 'invalid credentials');
  }
  if (!user.active) throw new HttpError(403, 'forbidden', 'user is inactive');
  await issueSession(res, user.id, randomUUID());
  await event('auth.login', { userId: user.id, targetType: 'user', targetId: user.id });
  const accessToken = await signAccessToken({ id: user.id, role: user.role, username: user.username });
  res.json({ accessToken, user: publicUser(user) });
});

// POST /refresh — rotation with family revocation on reuse (05 §3)
authRouter.post('/refresh', authLimiter, async (req, res) => {
  const raw = readRefreshCookie(req.headers.cookie);
  if (!raw) throw new HttpError(401, 'unauthorized', 'no refresh token');
  const row = await Tokens.findOne({ where: { tokenHash: hashRefreshToken(raw) } });
  if (!row) throw new HttpError(401, 'unauthorized', 'invalid refresh token');
  if (row.revokedAt) {
    await Tokens.update({ revokedAt: new Date() }, { where: { familyId: row.familyId, revokedAt: null } });
    await event('auth.token_reuse', { userId: row.userId, targetType: 'user', targetId: row.userId }, { familyId: row.familyId });
    res.clearCookie(COOKIE, { path: cookieOpts.path });
    throw new HttpError(401, 'unauthorized', 'refresh token reuse detected');
  }
  if (row.expiresAt.getTime() < Date.now()) {
    res.clearCookie(COOKIE, { path: cookieOpts.path });
    throw new HttpError(401, 'unauthorized', 'refresh token expired');
  }
  const user = await Users.findByPk(row.userId);
  if (!user) throw new HttpError(401, 'unauthorized', 'invalid refresh token');
  if (!user.active) throw new HttpError(403, 'forbidden', 'user is inactive');

  await row.update({ revokedAt: new Date() });
  await issueSession(res, user.id, row.familyId);
  const accessToken = await signAccessToken({ id: user.id, role: user.role, username: user.username });
  res.json({ accessToken, user: publicUser(user) });
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  const raw = readRefreshCookie(req.headers.cookie);
  if (raw) {
    await Tokens.update({ revokedAt: new Date() }, { where: { tokenHash: hashRefreshToken(raw), revokedAt: null } });
  }
  await event('auth.logout', { userId: req.user!.id, targetType: 'user', targetId: req.user!.id });
  res.clearCookie(COOKIE, { path: cookieOpts.path });
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await Users.findByPk(req.user!.id);
  if (!user) throw new HttpError(401, 'unauthorized', 'invalid token');
  res.json({ user: publicUser(user) });
});
