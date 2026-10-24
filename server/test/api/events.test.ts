import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prepareTestEnv, truncateAll } from '../globalSetup.js';

await prepareTestEnv();
const { app } = await import('../../src/index.js');

const ADMIN = { username: 'admin', password: 'correct-horse-battery' };

beforeEach(async () => {
  await truncateAll();
});

describe('events (06 §10)', () => {
  it('actions produced by the flows are visible, newest first, paginated; viewer 403', async () => {
    const setupRes = await request(app).post('/api/auth/setup').send(ADMIN);
    expect(setupRes.status).toBe(201);
    const admin = setupRes.body.accessToken as string;

    await request(app).post('/api/auth/login').send(ADMIN);
    await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong-password-here' });
    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${admin}`)
      .send({ username: 'viewer1', password: 'viewer-password-10', role: 'viewer' });

    const res = await request(app).get('/api/events').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    const actions = res.body.data.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['setup.completed', 'auth.login', 'auth.login_failed', 'user.created']));

    const dates = res.body.data.map((e: { createdAt: string }) => Date.parse(e.createdAt));
    expect(dates).toEqual([...dates].sort((a, b) => b - a)); // newest first
    expect(res.body.meta).toMatchObject({ page: 1, limit: 20 });
    expect(res.body.meta.total).toBe(actions.length);

    const setupEvent = res.body.data.find((e: { action: string }) => e.action === 'setup.completed');
    expect(setupEvent).toMatchObject({ action: 'setup.completed', user: { username: 'admin' }, targetType: 'user' });
    expect(setupEvent.targetId).toEqual(expect.any(String));

    const page = await request(app).get('/api/events?page=1&limit=2').set('Authorization', `Bearer ${admin}`);
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta.total).toBe(actions.length);

    const viewerLogin = await request(app).post('/api/auth/login').send({ username: 'viewer1', password: 'viewer-password-10' });
    const viewerEvents = await request(app).get('/api/events').set('Authorization', `Bearer ${viewerLogin.body.accessToken}`);
    expect(viewerEvents.status).toBe(403);
  });
});
