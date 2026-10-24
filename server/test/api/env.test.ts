import { beforeEach, describe, expect, it, vi } from 'vitest';

// 11 §4: real DB, the four side-effect services mocked (docker/git/certs/nginx)
vi.mock('../../src/services/docker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/docker.js')>();
  return {
    ...actual,
    compose: vi.fn(async () => ({ code: 0, output: '' })),
    reloadNginx: vi.fn(async () => ({ code: 0, output: '' })),
    runCertbot: vi.fn(async () => ({ code: 0, output: '' })),
    writeCompose: vi.fn(async () => undefined),
    removeAppData: vi.fn(async () => undefined),
    appHealth: vi.fn(async () => 'healthy'),
    appLogs: vi.fn(async () => ({ code: 0, output: '' })),
  };
});
vi.mock('../../src/services/nginx.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/nginx.js')>();
  return {
    ...actual,
    writeVhost: vi.fn(async () => undefined),
    writeVhostAndReload: vi.fn(async () => undefined),
    removeVhost: vi.fn(async () => undefined),
    removeVhosts: vi.fn(async () => undefined),
    reload: vi.fn(async () => undefined),
  };
});
vi.mock('../../src/services/git.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/git.js')>();
  return {
    ...actual,
    fetchSource: vi.fn(async () => ({ sha: 'f'.repeat(40), message: 'test commit', author: 'Tester' })),
  };
});
vi.mock('../../src/services/certs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/certs.js')>();
  return { ...actual, issueCert: vi.fn(async () => true) };
});

import request from 'supertest';
import { app, createApp, db, setupAdmin, truncateAll, bearer, createUser } from './helpers.js';
import { setDeployObserver } from '../../src/services/deploy-queue.js';

beforeEach(async () => {
  await truncateAll();
});

describe('env (11 §4)', () => {
  it('viewer gets masked, member gets values', async () => {
    const admin = await setupAdmin();
    const member = await createUser(admin, 'mem', 'member');
    const viewer = await createUser(admin, 'vie', 'viewer');
    const created = await createApp(admin);
    const appId = created.body.id;

    const put = await request(app)
      .put(`/api/apps/${appId}/env`)
      .set(bearer(member))
      .send({ vars: [{ key: 'DATABASE_URL', value: 'postgres://x' }, { key: 'API_TOKEN', value: 'tok3n' }] });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ applied: 2, redeployTriggered: false });

    const asViewer = await request(app).get(`/api/apps/${appId}/env`).set(bearer(viewer));
    expect(asViewer.status).toBe(200);
    expect(asViewer.body).toEqual([
      { key: 'API_TOKEN', masked: true },
      { key: 'DATABASE_URL', masked: true },
    ]);
    expect(JSON.stringify(asViewer.body)).not.toContain('tok3n');
    expect(JSON.stringify(asViewer.body)).not.toContain('postgres://x');

    const asMember = await request(app).get(`/api/apps/${appId}/env`).set(bearer(member));
    expect(asMember.body).toEqual([
      { key: 'API_TOKEN', value: 'tok3n' },
      { key: 'DATABASE_URL', value: 'postgres://x' },
    ]);
  });

  it('PUT is replace-all: removed keys disappear', async () => {
    const admin = await setupAdmin();
    const created = await createApp(admin);
    const appId = created.body.id;
    await request(app)
      .put(`/api/apps/${appId}/env`)
      .set(bearer(admin))
      .send({ vars: [{ key: 'A_ONE', value: '1' }, { key: 'B_TWO', value: '2' }] });

    await request(app)
      .put(`/api/apps/${appId}/env`)
      .set(bearer(admin))
      .send({ vars: [{ key: 'B_TWO', value: '2x' }, { key: 'C_THREE', value: '3' }] });

    const rows = await db.EnvVar.findAll({ where: { appId }, order: [['key', 'ASC']] });
    expect(rows.map((r) => r.get('key'))).toEqual(['B_TWO', 'C_THREE']);
    const res = await request(app).get(`/api/apps/${appId}/env`).set(bearer(admin));
    expect(res.body).toEqual([
      { key: 'B_TWO', value: '2x' },
      { key: 'C_THREE', value: '3' },
    ]);
  });

  it('applyNow triggers a redeploy (queue observed, not executed)', async () => {
    const admin = await setupAdmin();
    const created = await createApp(admin);
    const appId = created.body.id;

    const observed: string[] = [];
    setDeployObserver((_appId, deploymentId) => observed.push(deploymentId));
    try {
      const res = await request(app)
        .put(`/api/apps/${appId}/env`)
        .set(bearer(admin))
        .send({ vars: [{ key: 'PORT', value: '8080' }], applyNow: true });
      expect(res.status).toBe(200);
      expect(res.body.redeployTriggered).toBe(true);

      const queued = await db.Deployment.findAll({ where: { appId, status: 'queued' } });
      expect(queued).toHaveLength(1);
      expect(observed).toEqual([queued[0]!.get('id')]);
    } finally {
      setDeployObserver(null);
    }
  });
});
