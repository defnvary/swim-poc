// providers: QueryClient, ThemeMode, SnackbarProvider, Router (04 §1)
import { CssBaseline, ThemeProvider } from '@mui/material';
import { SnackbarProvider } from 'notistack';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { getTheme } from './theme';

interface ThemeModeValue {
  mode: 'light' | 'dark';
  toggle: () => void;
}

const ThemeModeContext = createContext<ThemeModeValue | null>(null);
export const useThemeMode = (): ThemeModeValue => {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) throw new Error('useThemeMode outside providers');
  return ctx;
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const Root = () => {
  // UI preference only — never the access token (02 NFR / 06 §1)
  const [mode, setMode] = useState<'light' | 'dark'>(() =>
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  const toggle = useCallback(() => setMode((m) => (m === 'light' ? 'dark' : 'light')), []);
  const theme = useMemo(() => getTheme(mode), [mode]);
  const themeValue = useMemo(() => ({ mode, toggle }), [mode, toggle]);

  return (
    <ThemeModeContext.Provider value={themeValue}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <SnackbarProvider maxSnack={3} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </AuthProvider>
          </QueryClientProvider>
        </SnackbarProvider>
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
};

// guarded so tests importing the module graph (AppShell ← useThemeMode) do not mount
const rootEl = document.getElementById('root');
if (rootEl) createRoot(rootEl).render(<Root />);
