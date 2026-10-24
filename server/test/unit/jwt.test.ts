import { describe, expect, it, vi, afterEach } from 'vitest';
import { SignJWT } from 'jose';

process.env.DATABASE_URL = 'postgres://swim:swim@localhost:5432/swim_test';
process.env.SWIM_JWT_SECRET = Buffer.alloc(32, 11).toString('base64');

const { signAccessToken, verifyAccessToken } = await import('../../src/lib/jwt.js');

const user = { id: '11111111-1111-4111-8111-111111111111', role: 'admin' as const, username: 'admin' };

afterEach(() => {
  vi.useRealTimers();
});

describe('access tokens (HS256, 15 min, sub/role/username)', () => {
  it('sign → verify roundtrip', async () => {
    vi.useFakeTimers();
    const token = await signAccessToken(user);
    const payload = await verifyAccessToken(token);
    expect(payload.sub).toBe(user.id);
  });

  it('expired token rejected', async () => {
    vi.useFakeTimers();
    const token = await signAccessToken(user);
    await expect(verifyAccessToken(token)).resolves.toBeTruthy();
    vi.advanceTimersByTime(16 * 60 * 1000);
    await expect(verifyAccessToken(token)).rejects.toThrow();
  });

  it('wrong-key token rejected', async () => {
    const forged = await new SignJWT({ role: 'admin', username: 'evil' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new Uint8Array(Buffer.alloc(32, 99)));
    await expect(verifyAccessToken(forged)).rejects.toThrow();
  });

  it('claims carry sub/role/username', async () => {
    vi.useFakeTimers();
    const payload = await verifyAccessToken(await signAccessToken(user));
    expect(payload).toMatchObject({ sub: user.id, role: 'admin', username: 'admin' });
    expect((payload.exp as number) - (payload.iat as number)).toBe(15 * 60);
  });
});
