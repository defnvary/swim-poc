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
import { app, createApp, db, setupAdmin, truncateAll, bearer } from './helpers.js';
import { setDeployObserver } from '../../src/services/deploy-queue.js';

beforeEach(async () => {
  await truncateAll();
});

describe('deployments (11 §4)', () => {
  it('manual deploy → 202 + queued row + deploy.queued event', async () => {
    const token = await setupAdmin();
    const created = await createApp(token);
    const appId = created.body.id;

    const observed: Array<{ appId: string; deploymentId: string }> = [];
    setDeployObserver((a, d) => observed.push({ appId: a, deploymentId: d }));
    try {
      const res = await request(app).post(`/api/apps/${appId}/deployments`).set(bearer(token)).send({});
      expect(res.status).toBe(202);
      expect(res.body.deployment.status).toBe('queued');
      expect(res.body.deployment.trigger).toBe('manual');
      expect(res.body.deployment.commitSha).toMatch(/^0{40}$/); // branch-HEAD marker (07 §3)

      const row = await db.Deployment.findByPk(res.body.deployment.id);
      expect(row).not.toBeNull();
      expect(row!.get('status')).toBe('queued');

      const event = await db.Event.findOne({ where: { action: 'deploy.queued' } });
      expect(event).not.toBeNull();
      expect(event!.get('targetId')).toBe(res.body.deployment.id);

      // phase-4 seam: the queue observed the hand-off; the pipeline itself is not run
      expect(observed).toEqual([{ appId, deploymentId: res.body.deployment.id }]);

      const sha = 'a'.repeat(40);
      const pinned = await request(app).post(`/api/apps/${appId}/deployments`).set(bearer(token)).send({ commitSha: sha });
      // the first deployment is still non-terminal (phase 4 moves it) → 409 covers it below;
      // pinning is proven by the row created once the slot frees
      expect(pinned.status).toBe(409);

      await row!.update({ status: 'failed' });
      const second = await request(app).post(`/api/apps/${appId}/deployments`).set(bearer(token)).send({ commitSha: sha });
      expect(second.status).toBe(202);
      expect(second.body.deployment.commitSha).toBe(sha);
    } finally {
      setDeployObserver(null);
    }
  });

  it('409 while a non-terminal deployment exists', async () => {
    const token = await setupAdmin();
    const created = await createApp(token);
    const appId = created.body.id;
    await db.Deployment.create({
      appId,
      commitSha: 'b'.repeat(40),
      branch: 'main',
      status: 'building',
      trigger: 'webhook',
    });
    const res = await request(app).post(`/api/apps/${appId}/deployments`).set(bearer(token)).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('conflict');
  });

  it('malformed commitSha → 422 validation_failed', async () => {
    const token = await setupAdmin();
    const created = await createApp(token);
    const res = await request(app)
      .post(`/api/apps/${created.body.id}/deployments`)
      .set(bearer(token))
      .send({ commitSha: 'nothex' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_failed');
  });
});
