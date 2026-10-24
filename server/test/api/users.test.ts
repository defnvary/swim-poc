import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prepareTestEnv, truncateAll } from '../globalSetup.js';

await prepareTestEnv();
const { app } = await import('../../src/index.js');

const ADMIN = { username: 'admin', password: 'correct-horse-battery' };

const setupAdmin = async () => {
  const res = await request(app).post('/api/auth/setup').send(ADMIN);
  return res.body.accessToken as string;
};

const login = async (username: string, password: string) => {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  expect(res.status).toBe(200);
  return res.body.accessToken as string;
};

const createUser = async (adminToken: string, username: string, role: string) => {
  const res = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ username, password: `${username}-password-10`, role });
  expect(res.status).toBe(201);
  return res.body.id as string;
};

beforeEach(async () => {
  await truncateAll();
});

describe('users', () => {
  it('RBAC matrix of 06 §2 holds for every users route', async () => {
    const admin = await setupAdmin();
    const viewerId = await createUser(admin, 'viewer1', 'viewer');
    const memberId = await createUser(admin, 'member1', 'member');
    const viewer = await login('viewer1', 'viewer1-password-10');
    const member = await login('member1', 'member1-password-10');

    for (const token of [viewer, member]) {
      expect((await request(app).get('/api/users').set('Authorization', `Bearer ${token}`)).status).toBe(403);
      expect(
        (await request(app)
          .post('/api/users')
          .set('Authorization', `Bearer ${token}`)
          .send({ username: 'nope', password: 'nope-nope-nope', role: 'viewer' })).status,
      ).toBe(403);
    }
    expect(
      (await request(app).patch(`/api/users/${memberId}`).set('Authorization', `Bearer ${viewer}`).send({ role: 'member' })).status,
    ).toBe(403);
    expect((await request(app).delete(`/api/users/${viewerId}`).set('Authorization', `Bearer ${member}`)).status).toBe(403);

    const adminGet = await request(app).get('/api/users').set('Authorization', `Bearer ${admin}`);
    expect(adminGet.status).toBe(200);
    expect(adminGet.body.data).toHaveLength(3);
    expect(adminGet.body.meta).toMatchObject({ page: 1, limit: 20, total: 3 });
  });

  it('no self-demotion or self-deactivation (409)', async () => {
    const admin = await setupAdmin();
    const me = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${admin}`)).body.user;

    const demote = await request(app).patch(`/api/users/${me.id}`).set('Authorization', `Bearer ${admin}`).send({ role: 'member' });
    expect(demote.status).toBe(409);
    const deactivate = await request(app).patch(`/api/users/${me.id}`).set('Authorization', `Bearer ${admin}`).send({ active: false });
    expect(deactivate.status).toBe(409);
  });

  it('last active admin cannot be demoted or deactivated (409)', async () => {
    const admin = await setupAdmin();
    const firstId = (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${admin}`)).body.user.id;
    const secondId = await createUser(admin, 'admin2', 'admin');
    const second = await login('admin2', 'admin2-password-10');

    // demoting the first admin succeeds while a second active admin exists
    const ok = await request(app).patch(`/api/users/${firstId}`).set('Authorization', `Bearer ${second}`).send({ role: 'member' });
    expect(ok.status).toBe(200);

    // now admin2 is the last active admin
    const demote = await request(app).patch(`/api/users/${secondId}`).set('Authorization', `Bearer ${second}`).send({ role: 'member' });
    expect(demote.status).toBe(409);
    const deactivate = await request(app).patch(`/api/users/${secondId}`).set('Authorization', `Bearer ${second}`).send({ active: false });
    expect(deactivate.status).toBe(409);
    const remove = await request(app).delete(`/api/users/${secondId}`).set('Authorization', `Bearer ${second}`);
    expect(remove.status).toBe(409); // self-delete also blocked, message aside
  });
});
