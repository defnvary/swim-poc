import { createHmac } from 'node:crypto';
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

beforeEach(async () => {
  await truncateAll();
});

const sign = (secret: string, body: string): string =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`; // computed in-test (11 §4)

interface HookTarget {
  hookId: string;
  secret: string;
}

const push = (target: HookTarget, body: string, event = 'push') =>
  request(app)
    .post(`/api/hooks/${target.hookId}`)
    .set('Content-Type', 'application/json')
    .set('X-Hub-Signature-256', sign(target.secret, body))
    .set('X-GitHub-Event', event)
    .send(body); // string body is sent byte-exact — signed over these bytes (10 §6)

const hookFor = async (adminToken: string, name = 'Hooked'): Promise<HookTarget> => {
  const created = await createApp(adminToken, { name });
  const url = created.body.webhook.url as string;
  return { hookId: url.split('/').pop()!, secret: created.body.webhook.secret as string };
};

describe('hooks (11 §4)', () => {
  it('valid HMAC push → 202 + queued webhook deployment row', async () => {
    const admin = await setupAdmin();
    const target = await hookFor(admin);

    const res = await push(target, JSON.stringify({ ref: 'refs/heads/main' }));
    expect(res.status).toBe(202);
    expect(res.body.deploymentId).toMatch(/^[0-9a-f-]{36}$/);

    const row = await db.Deployment.findByPk(res.body.deploymentId);
    expect(row).not.toBeNull();
    expect(row!.get('status')).toBe('queued');
    expect(row!.get('trigger')).toBe('webhook');

    const queued = await db.Event.findOne({ where: { action: 'deploy.queued' } });
    expect(queued).not.toBeNull();

    // no auth was sent — and none is expected (06 §12, public)
    const detail = await request(app).get(`/api/deployments/${res.body.deploymentId}`).set(bearer(admin));
    expect(detail.body.commitSha).toMatch(/^0{40}$/); // HEAD marker; pipeline resolves it (07 §3)
  });

  it('invalid signature → 401 bad_signature', async () => {
    const admin = await setupAdmin();
    const target = await hookFor(admin);
    const body = JSON.stringify({ ref: 'refs/heads/main' });

    const wrongSecret = await push(target, body); // control
    expect(wrongSecret.status).toBe(202);

    const forged = await request(app)
      .post(`/api/hooks/${target.hookId}`)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign('not-the-secret', body))
      .set('X-GitHub-Event', 'push')
      .send(body);
    expect(forged.status).toBe(401);
    expect(forged.body.error.code).toBe('bad_signature');

    const missing = await request(app)
      .post(`/api/hooks/${target.hookId}`)
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'push')
      .send(body);
    expect(missing.status).toBe(401);
  });

  it('ping → 200 ignored', async () => {
    const admin = await setupAdmin();
    const target = await hookFor(admin);
    const res = await push(target, JSON.stringify({ zen: 42 }), 'ping');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ignored: 'ping' });
  });

  it('non-tracked branch → 200 ignored', async () => {
    const admin = await setupAdmin();
    const target = await hookFor(admin);
    const res = await push(target, JSON.stringify({ ref: 'refs/heads/feature-x' }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ignored: 'branch' });
    expect(await db.Deployment.count()).toBe(0);
  });

  it('unknown hookId → 404 hook_not_found', async () => {
    const admin = await setupAdmin();
    const target = await hookFor(admin);
    const body = JSON.stringify({ ref: 'refs/heads/main' });
    const res = await request(app)
      .post('/api/hooks/00000000-0000-4000-8000-000000000000')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(target.secret, body))
      .set('X-GitHub-Event', 'push')
      .send(body);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('hook_not_found');
  });
});
