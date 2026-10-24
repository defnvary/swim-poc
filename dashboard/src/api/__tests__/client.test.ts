// 11 §6 — two concurrent requests both get 401: exactly one refresh fires,
// both requests retry with the new token.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../client';
import { setAccessToken } from '../../auth/AuthContext';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('api client refresh single-flight', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
  });

  it('shares one refresh between concurrent 401s and retries both', async () => {
    let refreshCalls = 0;
    const seenAuthHeaders: Array<string | null> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init?: RequestInit) => {
        if (path === '/api/auth/refresh') {
          refreshCalls += 1;
          return jsonResponse(200, { accessToken: 't2' });
        }
        const auth = (init?.headers as Record<string, string>)?.['Authorization'] ?? null;
        seenAuthHeaders.push(auth);
        // stale token → 401; fresh token → 200
        if (auth === 'Bearer t1') return jsonResponse(401, { error: { code: 'unauthorized', message: 'expired' } });
        return jsonResponse(200, { ok: path });
      }),
    );

    setAccessToken('t1');
    const [a, b] = await Promise.all([api<{ ok: string }>('/api/a'), api<{ ok: string }>('/api/b')]);

    expect(refreshCalls).toBe(1);
    expect(a.ok).toBe('/api/a');
    expect(b.ok).toBe('/api/b');
    // each path hit twice: once with the stale token, once with the rotated one
    expect(seenAuthHeaders.filter((h) => h === 'Bearer t1')).toHaveLength(2);
    expect(seenAuthHeaders.filter((h) => h === 'Bearer t2')).toHaveLength(2);
  });

  it('logs out when the refresh itself fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) =>
        path === '/api/auth/refresh'
          ? jsonResponse(401, { error: { code: 'unauthorized', message: 'reuse' } })
          : jsonResponse(401, { error: { code: 'unauthorized', message: 'expired' } }),
      ),
    );

    const logout = vi.fn();
    // trigger the module-level handler wiring lazily via the export
    const { setLogoutHandler } = await import('../client');
    setLogoutHandler(logout);
    setAccessToken('t1');

    await expect(api('/api/a')).rejects.toMatchObject({ status: 401 });
    expect(logout).toHaveBeenCalledOnce();
    setLogoutHandler(null);
  });
});
