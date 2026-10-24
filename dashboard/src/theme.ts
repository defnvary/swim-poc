import { createTheme } from '@mui/material/styles';

// 04 §1 — one theme factory for light/dark; primary is Swim's deep-water blue.
export const getTheme = (mode: 'light' | 'dark') =>
  createTheme({
    palette: {
      mode,
      primary: { main: mode === 'light' ? '#0369a1' : '#38bdf8' },
      secondary: { main: '#0d9488' },
      // a `background: undefined` key would deep-merge over MUI's defaults and erase them
      ...(mode === 'dark' && { background: { default: '#0b1120', paper: '#111a2e' } }),
    },
    typography: { fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif', h6: { fontWeight: 600 } },
    shape: { borderRadius: 8 },
  });
