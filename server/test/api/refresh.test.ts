import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prepareTestEnv, truncateAll } from '../globalSetup.js';

await prepareTestEnv();
const { app } = await import('../../src/index.js');
const { db } = await import('../../src/db/sequelize.js');
const { hashRefreshToken } = await import('../../src/lib/jwt.js');

const ADMIN = { username: 'admin', password: 'correct-horse-battery' };

const refreshCookie = (res: request.Response): string => {
  const raw = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const c = arr.find((s) => s.startsWith('swim_refresh='));
  return c ? c.split(';')[0]! : '';
};

const setupAdmin = async () => {
  const res = await request(app).post('/api/auth/setup').send(ADMIN);
  return { token: res.body.accessToken as string, cookie: refreshCookie(res) };
};

const tokenValue = (cookie: string) => cookie.split('=')[1]!;

beforeEach(async () => {
  await truncateAll();
});

describe('refresh rotation (05 §3)', () => {
  it('refresh rotates: old row revoked, successor shares familyId', async () => {
    const { cookie: c1 } = await setupAdmin();
    const res = await request(app).post('/api/auth/refresh').set('Cookie', c1);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    const c2 = refreshCookie(res);
    expect(c2).not.toBe(c1);

    const old = await db.RefreshToken.findOne({ where: { tokenHash: hashRefreshToken(tokenValue(c1)) } });
    const next = await db.RefreshToken.findOne({ where: { tokenHash: hashRefreshToken(tokenValue(c2)) } });
    expect(old!.revokedAt).not.toBeNull();
    expect(next!.familyId).toBe(old!.familyId);
    expect(next!.id).not.toBe(old!.id);
  });

  it('reusing a rotated token revokes the whole family → 401 + auth.token_reuse', async () => {
    const { cookie: c1 } = await setupAdmin();
    const rotated = await request(app).post('/api/auth/refresh').set('Cookie', c1);
    const c2 = refreshCookie(rotated);

    const reuse = await request(app).post('/api/auth/refresh').set('Cookie', c1);
    expect(reuse.status).toBe(401);

    const familyId = (await db.RefreshToken.findOne({ where: { tokenHash: hashRefreshToken(tokenValue(c1)) } }))!.familyId;
    const unrevoked = await db.RefreshToken.count({ where: { familyId, revokedAt: null } });
    expect(unrevoked).toBe(0); // successor c2 killed with the family

    const login = await request(app).post('/api/auth/login').send(ADMIN);
    const events = await request(app).get('/api/events').set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(events.body.data.some((e: { action: string }) => e.action === 'auth.token_reuse')).toBe(true);
  });

  it('expired refresh token → 401', async () => {
    const { cookie: c1 } = await setupAdmin();
    await db.RefreshToken.update(
      { expiresAt: new Date(Date.now() - 1000) },
      { where: { tokenHash: hashRefreshToken(tokenValue(c1)) } },
    );
    const res = await request(app).post('/api/auth/refresh').set('Cookie', c1);
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeDefined(); // cookie cleared
  });
});
