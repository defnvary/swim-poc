import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prepareTestEnv, truncateAll } from '../globalSetup.js';

await prepareTestEnv();
const { app } = await import('../../src/index.js');
const { db } = await import('../../src/db/sequelize.js');

const ADMIN = { username: 'admin', password: 'correct-horse-battery' };

const setCookies = (res: request.Response): string[] => {
  const raw = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
};
const refreshCookie = (res: request.Response): string => {
  const c = setCookies(res).find((s) => s.startsWith('swim_refresh='));
  return c ? c.split(';')[0]! : '';
};

const setupAdmin = async () => {
  const res = await request(app).post('/api/auth/setup').send(ADMIN);
  expect(res.status).toBe(201);
  return { token: res.body.accessToken as string, cookie: refreshCookie(res) };
};

beforeEach(async () => {
  await truncateAll();
});

describe('auth', () => {
  it('setup creates the admin while zero users exist, then 409', async () => {
    const res = await request(app).post('/api/auth/setup').send(ADMIN);
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ username: 'admin', role: 'admin' });
    expect(await db.User.count()).toBe(1);

    const second = await request(app).post('/api/auth/setup').send({ username: 'other', password: 'another-password' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('conflict');
  });

  it('setup.completed event written', async () => {
    const { token } = await setupAdmin();
    const events = await request(app).get('/api/events').set('Authorization', `Bearer ${token}`);
    expect(events.status).toBe(200);
    const created = events.body.data.find((e: { action: string }) => e.action === 'setup.completed');
    expect(created).toMatchObject({ action: 'setup.completed', user: { username: 'admin' }, targetType: 'user' });
  });

  it('login issues tokens + cookie', async () => {
    await setupAdmin();
    const res = await request(app).post('/api/auth/login').send(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ username: 'admin', role: 'admin' });
    const cookie = setCookies(res).find((s) => s.startsWith('swim_refresh='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth/i);
    expect(cookie).toMatch(/Max-Age=604800/);
  });

  it('wrong password → 401 invalid_credentials + auth.login_failed event', async () => {
    const { token } = await setupAdmin();
    const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'totally-wrong-pass' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
    const events = await request(app).get('/api/events').set('Authorization', `Bearer ${token}`);
    expect(events.body.data.some((e: { action: string }) => e.action === 'auth.login_failed')).toBe(true);
  });

  it('inactive user → 403', async () => {
    const { token } = await setupAdmin();
    const created = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'member1', password: 'member-password', role: 'member' });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const before = await request(app).post('/api/auth/login').send({ username: 'member1', password: 'member-password' });
    expect(before.status).toBe(200);

    await request(app).delete(`/api/users/${id}`).set('Authorization', `Bearer ${token}`);
    const after = await request(app).post('/api/auth/login').send({ username: 'member1', password: 'member-password' });
    expect(after.status).toBe(403);
  });
});
