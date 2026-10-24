import request from 'supertest';
import { prepareTestEnv, truncateAll } from '../globalSetup.js';

// Shared harness for the 11 §4 suites: the real Express app, the real test database.
// Each test file installs its own vi.mock of services/{docker,git,certs,nginx}
// BEFORE importing this module (vitest hoists vi.mock above imports).
await prepareTestEnv();
const { app } = await import('../../src/index.js');
const { db } = await import('../../src/db/sequelize.js');

export { app, db, truncateAll };

export const ADMIN = { username: 'admin', password: 'correct-horse-battery' };
export const pw = (name: string) => `${name}-password-10`;

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export const setupAdmin = async (): Promise<string> => {
  const res = await request(app).post('/api/auth/setup').send(ADMIN);
  expectSetupOk(res);
  return res.body.accessToken as string;
};
const expectSetupOk = (res: request.Response) => {
  if (res.status !== 201) throw new Error(`setup failed: ${res.status} ${JSON.stringify(res.body)}`);
};

export const login = async (username: string, password: string): Promise<string> => {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  if (res.status !== 200) throw new Error(`login failed for ${username}: ${res.status}`);
  return res.body.accessToken as string;
};

export const createUser = async (adminToken: string, username: string, role: string): Promise<string> => {
  const res = await request(app)
    .post('/api/users')
    .set(bearer(adminToken))
    .send({ username, password: pw(username), role });
  if (res.status !== 201) throw new Error(`create user failed: ${res.status} ${JSON.stringify(res.body)}`);
  return login(username, pw(username));
};

// 06 §5 create — returns the one response that carries the webhook secret
export const createApp = async (
  token: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; body: any }> => {
  const res = await request(app)
    .post('/api/apps')
    .set(bearer(token))
    .send({ name: 'Demo', repoOwner: 'acme', repoName: 'demo', ...body });
  if (res.status !== 201) throw new Error(`create app failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res;
};
