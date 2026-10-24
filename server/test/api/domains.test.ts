import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { dns } from '../../src/services/certs.js';

beforeEach(async () => {
  await truncateAll();
});

const realResolve4 = dns.resolve4;
afterEach(() => {
  dns.resolve4 = realResolve4;
});

describe('domains (11 §4)', () => {
  it('add → 201 pending + row', async () => {
    const token = await setupAdmin();
    const created = await createApp(token);
    const res = await request(app)
      .post(`/api/apps/${created.body.id}/domains`)
      .set(bearer(token))
      .send({ host: 'shop.example.com' });
    expect(res.status).toBe(201);
    expect(res.body.certStatus).toBe('pending');
    expect(res.body.host).toBe('shop.example.com');

    const row = await db.Domain.findByPk(res.body.id);
    expect(row).not.toBeNull();
    expect(row!.get('appId')).toBe(created.body.id);
  });

  it('duplicate host → 409 (same app and across apps)', async () => {
    const token = await setupAdmin();
    const a = await createApp(token, { name: 'First' });
    const b = await createApp(token, { name: 'Second' });
    const first = await request(app)
      .post(`/api/apps/${a.body.id}/domains`)
      .set(bearer(token))
      .send({ host: 'shop.example.com' });
    expect(first.status).toBe(201);

    const dup = await request(app)
      .post(`/api/apps/${a.body.id}/domains`)
      .set(bearer(token))
      .send({ host: 'shop.example.com' });
    expect(dup.status).toBe(409);

    const crossApp = await request(app)
      .post(`/api/apps/${b.body.id}/domains`)
      .set(bearer(token))
      .send({ host: 'shop.example.com' });
    expect(crossApp.status).toBe(409);
  });

  it('deleting the default domain → 409', async () => {
    const token = await setupAdmin();
    const created = await createApp(token);
    const detail = await request(app).get(`/api/apps/${created.body.id}`).set(bearer(token));
    const defaultDomain = detail.body.domains.find((d: { host: string }) => d.host === 'demo.swim.test');
    expect(defaultDomain).toBeDefined();

    const res = await request(app).delete(`/api/domains/${defaultDomain.id}`).set(bearer(token));
    expect(res.status).toBe(409);
    const row = await db.Domain.findByPk(defaultDomain.id);
    expect(row).not.toBeNull();
  });

  it('verify returns the DNS shape with the resolver stubbed', async () => {
    const token = await setupAdmin();
    const created = await createApp(token);
    const added = await request(app)
      .post(`/api/apps/${created.body.id}/domains`)
      .set(bearer(token))
      .send({ host: 'shop.example.com' });

    const SERVER = '203.0.113.7';
    dns.resolve4 = vi.fn(async (host: string) => (host === 'shop.example.com' || host === 'swim.swim.test' ? [SERVER] : []));

    const res = await request(app).post(`/api/domains/${added.body.id}/verify`).set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      host: 'shop.example.com',
      certStatus: 'pending',
      dns: { resolved: true, pointsToServer: true },
    });
  });
});
