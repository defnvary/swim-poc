// shared fixture + render helper for the dashboard smokes (11 §6)
import { SnackbarProvider } from 'notistack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { render } from '@testing-library/react';
import { AuthProvider } from '../auth/AuthContext';
import type { AppFull, AppSummary, Deployment, Domain, EventRow, User } from '../api/types';

export const ADMIN: User = { id: 'u-1', username: 'admin', role: 'admin', createdAt: '2026-10-01T00:00:00.000Z' };

export const APP_SUMMARY: AppSummary = {
  id: 'a-1', name: 'Demo App', slug: 'demo-app', repoOwner: 'acme', repoName: 'demo', branch: 'main',
  port: 3000, healthcheckPath: '/', buildType: 'auto', autoDeploy: true, status: 'live',
  hasToken: true, tokenLast4: '1f9a', currentDeploymentId: 'd-1', createdAt: '2026-10-01T00:00:00.000Z',
};

export const APP_FULL: AppFull = {
  ...APP_SUMMARY,
  domains: [{ id: 'dom-1', host: 'demo-app.swim.test', certStatus: 'issued', certIssuedAt: null, createdAt: '2026-10-01T00:00:00.000Z' }],
  currentDeployment: { id: 'd-1', commitSha: 'a'.repeat(40), commitMessage: 'init', author: 'acme', status: 'live', createdAt: '2026-10-01T00:00:00.000Z' },
};

export const DEPLOYMENT: Deployment = {
  id: 'd-1', appId: 'a-1', commitSha: 'a'.repeat(40), commitMessage: 'init', author: 'acme', branch: 'main',
  status: 'live', trigger: 'manual', triggeredBy: 'admin', error: null, startedAt: null, finishedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
};

export const DOMAIN: Domain = { id: 'dom-1', host: 'custom.example.com', certStatus: 'pending', certIssuedAt: null, createdAt: '2026-10-01T00:00:00.000Z' };

export const EVENT: EventRow = {
  id: 'e-1', action: 'app.created', user: { username: 'admin' }, targetType: 'app', targetId: 'a-1',
  details: { slug: 'demo-app' }, createdAt: '2026-10-01T00:00:00.000Z',
};

export const page = <T,>(data: T[]) => ({ data, meta: { page: 1, limit: 20, total: data.length } });

export const renderWithProviders = (ui: ReactNode, route = '/') =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SnackbarProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </AuthProvider>
      </SnackbarProvider>
    </QueryClientProvider>,
  );
