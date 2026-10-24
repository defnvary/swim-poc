// render smokes per page with api/client mocked (11 §6)
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => {
  const ADMIN = { id: 'u-1', username: 'admin', role: 'admin', createdAt: '2026-10-01T00:00:00.000Z' };
  const APP = {
    id: 'a-1', name: 'Demo App', slug: 'demo-app', repoOwner: 'acme', repoName: 'demo', branch: 'main',
    port: 3000, healthcheckPath: '/', buildType: 'auto' as const, autoDeploy: true, status: 'live' as const,
    hasToken: true, tokenLast4: '1f9a', currentDeploymentId: 'd-1', createdAt: '2026-10-01T00:00:00.000Z',
  };
  const DEPLOYMENT = {
    id: 'd-1', appId: 'a-1', commitSha: 'a'.repeat(40), commitMessage: 'init commit', author: 'acme',
    branch: 'main', status: 'live' as const, trigger: 'manual' as const, triggeredBy: 'admin',
    error: null, startedAt: null, finishedAt: null, createdAt: '2026-10-01T00:00:00.000Z',
  };
  const pg = (data: unknown[]) => ({ data, meta: { page: 1, limit: 20, total: data.length } });
  return {
    ApiError: class extends Error {},
    api: vi.fn(async (path: string) => (path === '/api/auth/me' ? { user: ADMIN } : {})),
    setLogoutHandler: vi.fn(),
    apiAuth: {
      setup: vi.fn(), login: vi.fn(), logout: vi.fn(),
      me: vi.fn(async () => ({ user: ADMIN })),
    },
    apiApps: {
      list: vi.fn(async () => pg([APP])),
      get: vi.fn(async () => ({
        ...APP,
        domains: [{ id: 'dom-1', host: 'custom.example.com', certStatus: 'pending', certIssuedAt: null, createdAt: '' }],
        currentDeployment: { id: 'd-1', commitSha: 'a'.repeat(40), commitMessage: 'init commit', author: 'acme', status: 'live', createdAt: '' },
      })),
      create: vi.fn(), patch: vi.fn(), remove: vi.fn(),
      rotateHook: vi.fn(async () => ({ webhook: { url: 'https://u', secret: 's' } })),
      stop: vi.fn(), start: vi.fn(),
    },
    apiDeployments: {
      list: vi.fn(async () => pg([DEPLOYMENT])),
      create: vi.fn(), get: vi.fn(),
    },
    apiDomains: {
      list: vi.fn(async () => [{ id: 'dom-1', host: 'custom.example.com', certStatus: 'pending', certIssuedAt: null, createdAt: '' }]),
      add: vi.fn(), remove: vi.fn(), verify: vi.fn(),
    },
    apiEnv: {
      get: vi.fn(async () => [{ key: 'API_KEY', value: 'secret' }]),
      put: vi.fn(),
    },
    apiUsers: {
      list: vi.fn(async () => pg([{ ...ADMIN, active: true }])),
      create: vi.fn(), patch: vi.fn(), remove: vi.fn(),
    },
    apiEvents: {
      list: vi.fn(async () => pg([{ id: 'e-1', action: 'app.created', user: { username: 'admin' }, targetType: 'app', targetId: 'a-1', details: { slug: 'demo-app' }, createdAt: '' }])),
    },
  };
});

const { renderWithProviders } = await import('./helpers');

afterEach(() => cleanup());
const { LoginPage } = await import('../pages/LoginPage');
const { SetupPage } = await import('../pages/SetupPage');
const { AppsPage } = await import('../pages/AppsPage');
const { NewAppPage } = await import('../pages/NewAppPage');
const { AppDetailPage } = await import('../pages/AppDetailPage');
const { UsersPage } = await import('../pages/UsersPage');
const { EventsPage } = await import('../pages/EventsPage');

describe('page render smokes (11 §6)', () => {
  it('LoginPage shows the credentials form', async () => {
    renderWithProviders(<LoginPage />, '/login');
    await waitFor(() => expect(screen.getByLabelText('Username')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Log in' })).toBeTruthy();
  });

  it('SetupPage shows first-run admin creation', async () => {
    renderWithProviders(<SetupPage />, '/setup');
    await waitFor(() => expect(screen.getByText('Swim — first run')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Create admin' })).toBeTruthy();
  });

  it('AppsPage renders app cards from the query result', async () => {
    renderWithProviders(<AppsPage />);
    await waitFor(() => expect(screen.getByText('Demo App')).toBeTruthy());
    expect(screen.getByText('acme/demo@main')).toBeTruthy();
  });

  it('NewAppPage renders the 3 wizard steps', async () => {
    renderWithProviders(<NewAppPage />, '/apps/new');
    for (const label of ['Repository', 'Build config', 'Create']) expect(screen.getByText(label)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Repo owner'), { target: { value: 'acme' } });
    fireEvent.change(screen.getByLabelText('Repo name'), { target: { value: 'demo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByLabelText('App name')).toBeTruthy());
  });

  it('AppDetailPage renders all six tabs', async () => {
    renderWithProviders(<AppDetailPage />, '/apps/a-1');
    for (const t of ['Overview', 'Deployments', 'Logs', 'Environment', 'Domains', 'Settings']) {
      await waitFor(() => expect(screen.getByRole('tab', { name: t })).toBeTruthy());
    }
    fireEvent.click(screen.getByRole('tab', { name: 'Deployments' }));
    await waitFor(() => expect(screen.getByText(/init commit/)).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: 'Environment' }));
    await waitFor(() => expect(screen.getByDisplayValue('API_KEY')).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: 'Domains' }));
    await waitFor(() => expect(screen.getByText('custom.example.com')).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    await waitFor(() => expect(screen.getByText('Danger zone')).toBeTruthy());
  });

  it('UsersPage renders the admin table', async () => {
    renderWithProviders(<UsersPage />, '/users');
    await waitFor(() => expect(screen.getByText('admin (you)')).toBeTruthy());
  });

  it('EventsPage renders audit rows', async () => {
    renderWithProviders(<EventsPage />, '/events');
    await waitFor(() => expect(screen.getByText('app.created')).toBeTruthy());
  });
});
