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

const NO_SECRET_KEYS = ['webhookSecret', 'accessToken', 'accessTokenEnc', 'webhookSecretEnc', 'valueEnc'];
const expectNoSecrets = (body: unknown) => {
  const text = JSON.stringify(body);
  for (const key of NO_SECRET_KEYS) expect(text).not.toContain(key);
};

describe('apps (11 §4)', () => {
  it('create → 201, and the response is the only one containing the webhook secret', async () => {
    const token = await setupAdmin();
    const res = await createApp(token);
    expect(res.status).toBe(201);
    expect(res.body.webhook.secret).toMatch(/^[0-9a-f]{40}$/);
    expect(res.body.webhook.url).toMatch(/^https:\/\/swim\.swim\.test\/api\/hooks\/[0-9a-f-]{36}$/);
    expect(res.body.slug).toBe('demo');
    expect(res.body.status).toBe('created');

    const detail = await request(app).get(`/api/apps/${res.body.id}`).set(bearer(token));
    expect(detail.status).toBe(200);
    expect(detail.body.webhook).toBeUndefined();
    expectNoSecrets(detail.body);

    const list = await request(app).get('/api/apps').set(bearer(token));
    expectNoSecrets(list.body);

    const patched = await request(app).patch(`/api/apps/${res.body.id}`).set(bearer(token)).send({ name: 'Demo2' });
    expect(patched.body.webhook).toBeUndefined();
    expectNoSecrets(patched.body);
  });

  it('duplicate name → slug suffixed', async () => {
    const token = await setupAdmin();
    const a = await createApp(token, { name: 'Demo App' });
    const b = await createApp(token, { name: 'Demo App' });
    const c = await createApp(token, { name: 'Demo App' });
    expect([a.body.slug, b.body.slug, c.body.slug]).toEqual(['demo-app', 'demo-app-2', 'demo-app-3']);
    expect(b.status).toBe(201);
  });

  it('PATCH with accessToken updates tokenLast4', async () => {
    const token = await setupAdmin();
    const created = await createApp(token, { accessToken: 'github_pat_first_1f9a' });
    expect(created.body.hasToken).toBe(true);
    expect(created.body.tokenLast4).toBe('1f9a');
    const patched = await request(app)
      .patch(`/api/apps/${created.body.id}`)
      .set(bearer(token))
      .send({ accessToken: 'github_pat_second_beef' });
    expect(patched.status).toBe(200);
    expect(patched.body.tokenLast4).toBe('beef');
  });

  it('rotate-hook returns a new secret and the old hookId 404s afterwards', async () => {
    const token = await setupAdmin();
    const created = await createApp(token);
    const oldUrl = created.body.webhook.url as string;

    const rotated = await request(app).post(`/api/apps/${created.body.id}/rotate-hook`).set(bearer(token));
    expect(rotated.status).toBe(200);
    expect(rotated.body.webhook.secret).toMatch(/^[0-9a-f]{40}$/);
    expect(rotated.body.webhook.secret).not.toBe(created.body.webhook.secret);
    expect(rotated.body.webhook.url).not.toBe(oldUrl);

    const oldHookId = oldUrl.split('/').pop()!;
    const forged = await request(app).post(`/api/hooks/${oldHookId}`).send({ ref: 'refs/heads/main' });
    expect(forged.status).toBe(404);

    const detail = await request(app).get(`/api/apps/${created.body.id}`).set(bearer(token));
    expectNoSecrets(detail.body);
  });

  it('app JSON never contains secret fields', async () => {
    const token = await setupAdmin();
    const created = await createApp(token, { accessToken: 'github_pat_topsecret_1234' });
    expectNoSecrets(created.body);
    expect(created.body.webhook.secret).toBeDefined(); // the single sanctioned exposure (06 §5)

    await request(app).post(`/api/apps/${created.body.id}/rotate-hook`).set(bearer(token));
    const list = await request(app).get('/api/apps').set(bearer(token));
    const detail = await request(app).get(`/api/apps/${created.body.id}`).set(bearer(token));
    expectNoSecrets(list.body);
    expectNoSecrets(detail.body);

    // encrypted material never leaks through the DB-shaped JSON either
    const row = await db.App.findByPk(created.body.id);
    expect(row!.get('accessTokenEnc')).not.toContain('topsecret');
    expect(row!.get('webhookSecretEnc')).toMatch(/^v1:/);
  });
});
