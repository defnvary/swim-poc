// 04 §2 — the ONLY module that talks HTTP for JSON endpoints. 401 → one shared
// refresh (single-flight) → retry once → logout. Components never call fetch.
import { getAccessToken, setAccessToken } from '../auth/AuthContext';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

let logoutHandler: (() => void) | null = null;
export const setLogoutHandler = (fn: (() => void) | null): void => {
  logoutHandler = fn;
};

// single-flight: concurrent 401s share one refresh promise (11 §6)
let refreshing: Promise<string | null> | null = null;
const refreshOnce = (): Promise<string | null> => {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then((res) => (res.ok ? (res.json() as Promise<{ accessToken: string }>) : null))
    .then((j) => {
      if (!j) return null;
      setAccessToken(j.accessToken);
      return j.accessToken;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
};

const send = (path: string, init: RequestInit = {}, token: string | null) =>
  fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });

const parse = async (res: Response): Promise<unknown> => {
  if (res.status === 204) return undefined;
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
};

export const api = async <T = unknown>(path: string, init: RequestInit = {}): Promise<T> => {
  let res = await send(path, init, getAccessToken());
  if (res.status === 401) {
    const token = await refreshOnce();
    if (!token) {
      setAccessToken(null);
      logoutHandler?.();
      throw new ApiError(401, 'unauthorized', 'session expired');
    }
    res = await send(path, init, token);
  }
  const body = await parse(res);
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new ApiError(res.status, e?.code ?? 'internal', e?.message ?? res.statusText, e?.details);
  }
  return body as T;
};

const qs = (params: Record<string, string | number | boolean | undefined | null>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

const post = <T = unknown>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

// typed helpers per resource (06 §3–§10)
export const apiAuth = {
  setup: (b: { username: string; password: string }) => post<{ accessToken: string; user: unknown }>('/api/auth/setup', b),
  login: (b: { username: string; password: string }) => post<{ accessToken: string; user: unknown }>('/api/auth/login', b),
  me: () => api<{ user: unknown }>('/api/auth/me'),
  logout: () => post('/api/auth/logout'),
};

export const apiUsers = {
  list: (page = 1, limit = 20) => api(`/api/users${qs({ page, limit })}`),
  create: (b: { username: string; password: string; role: string }) => post('/api/users', b),
  patch: (id: string, b: { role?: string; active?: boolean; password?: string }) => patch(`/api/users/${id}`, b),
  remove: (id: string) => api(`/api/users/${id}`, { method: 'DELETE' }),
};

export const apiApps = {
  list: (page = 1, limit = 20) => api(`/api/apps${qs({ page, limit })}`),
  get: (id: string) => api(`/api/apps/${id}`),
  create: (b: Record<string, unknown>) => post('/api/apps', b),
  patch: (id: string, b: Record<string, unknown>) => patch(`/api/apps/${id}`, b),
  remove: (id: string) => api(`/api/apps/${id}`, { method: 'DELETE' }),
  rotateHook: (id: string) => post<{ webhook: { url: string; secret: string } }>(`/api/apps/${id}/rotate-hook`),
  stop: (id: string) => post<{ status: string }>(`/api/apps/${id}/stop`),
  start: (id: string) => post<{ status: string }>(`/api/apps/${id}/start`),
};

export const apiDeployments = {
  list: (appId: string, page = 1, limit = 20) => api(`/api/apps/${appId}/deployments${qs({ page, limit })}`),
  create: (appId: string, commitSha?: string) => post(`/api/apps/${appId}/deployments`, commitSha ? { commitSha } : {}),
  get: (id: string) => api(`/api/deployments/${id}`),
};

export const apiDomains = {
  list: (appId: string) => api(`/api/apps/${appId}/domains`),
  add: (appId: string, host: string) => post('/api/apps/' + appId + '/domains', { host }),
  remove: (id: string) => api(`/api/domains/${id}`, { method: 'DELETE' }),
  verify: (id: string) => post(`/api/domains/${id}/verify`),
};

export const apiEnv = {
  get: (appId: string) => api(`/api/apps/${appId}/env`),
  put: (appId: string, vars: { key: string; value: string }[], applyNow: boolean) =>
    api(`/api/apps/${appId}/env`, { method: 'PUT', body: JSON.stringify({ vars, applyNow }) }),
};

export const apiEvents = {
  list: (page = 1, limit = 20, action?: string) => api(`/api/events${qs({ page, limit, action })}`),
};
