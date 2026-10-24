// AuthContext: token in memory, login/logout, unauthenticated bootstrap redirect (11 §6)
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { AuthProvider, getAccessToken, useAuth } from '../AuthContext';
import { App } from '../../App';

// expose auth functions to tests without extra UI
type Auth = { login: (u: string, p: string) => Promise<void>; logout: () => Promise<void> };
let authRef: Auth | null = null;

const Consumer = () => {
  const { login, logout, user, phase } = useAuth();
  authRef = { login, logout };
  return (
    <div>
      <span data-testid="phase">{phase}</span>
      <span data-testid="user">{user?.username ?? 'none'}</span>
    </div>
  );
};

const jsonResponse = (status: number, body: unknown) => ({
  status,
  ok: status >= 200 && status < 300,
  statusText: 'x',
  text: async () => JSON.stringify(body),
});

beforeEach(() => {
  authRef = null;
  vi.unstubAllGlobals();
});

afterEach(() => cleanup());

describe('AuthContext', () => {
  it('login stores the access token in memory and exposes the user', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url) === '/api/auth/me') return jsonResponse(401, { error: { code: 'unauthorized', message: 'no' } });
      if (String(url) === '/api/auth/refresh') return jsonResponse(401, { error: {} });
      if (String(url) === '/api/auth/login') return jsonResponse(200, { accessToken: 'tok-1', user: { id: 'u', username: 'admin', role: 'admin', createdAt: '' } });
      return jsonResponse(404, {});
    }));
    render(
      <AuthProvider>
        <MemoryRouter>
          <Consumer />
        </MemoryRouter>
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('anonymous'));
    await act(() => authRef!.login('admin', 'password-long-enough'));
    expect(getAccessToken()).toBe('tok-1');
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('admin'));
  });

  it('logout clears token and user', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url) === '/api/auth/login') return jsonResponse(200, { accessToken: 'tok-2', user: { id: 'u', username: 'admin', role: 'admin', createdAt: '' } });
      if (String(url) === '/api/auth/logout') return jsonResponse(204, undefined);
      return jsonResponse(401, { error: {} });
    }));
    render(
      <AuthProvider>
        <MemoryRouter>
          <Consumer />
        </MemoryRouter>
      </AuthProvider>,
    );
    await waitFor(() => expect(authRef).not.toBeNull());
    await act(() => authRef!.login('admin', 'password-long-enough'));
    expect(getAccessToken()).toBe('tok-2');
    await act(() => authRef!.logout());
    expect(getAccessToken()).toBeNull();
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('none'));
  });

  it('unauthenticated bootstrap redirects to the login page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: { code: 'unauthorized', message: 'nope' } })));
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/users']}>
          <App />
        </MemoryRouter>
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('First run?')).toBeTruthy());
  });
});
