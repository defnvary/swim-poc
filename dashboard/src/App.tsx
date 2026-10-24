// route table + guards (04 §1)
import { Box, CircularProgress } from '@mui/material';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { useAuth } from './auth/AuthContext';
import { AppShell } from './components/AppShell';
import { AppDetailPage } from './pages/AppDetailPage';
import { AppsPage } from './pages/AppsPage';
import { EventsPage } from './pages/EventsPage';
import { LoginPage } from './pages/LoginPage';
import { NewAppPage } from './pages/NewAppPage';
import { SetupPage } from './pages/SetupPage';
import { UsersPage } from './pages/UsersPage';

const RequireAuth = ({ children }: { children: ReactNode }) => {
  const { phase } = useAuth();
  const location = useLocation();
  if (phase === 'loading') return <Box sx={{ display: 'grid', placeItems: 'center', height: '60vh' }}><CircularProgress /></Box>;
  if (phase === 'anonymous') return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
};

const RequireAdmin = ({ children }: { children: ReactNode }) =>
  useAuth().user?.role === 'admin' ? <>{children}</> : <Navigate to="/" replace />;

const RequireMember = ({ children }: { children: ReactNode }) => {
  const role = useAuth().user?.role;
  return role === 'member' || role === 'admin' ? <>{children}</> : <Navigate to="/" replace />;
};

export const App = () => {
  const { phase } = useAuth();
  if (phase === 'loading') {
    return <Box sx={{ display: 'grid', placeItems: 'center', height: '100vh' }}><CircularProgress /></Box>;
  }
  if (phase === 'ready') {
    return (
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/setup" element={<Navigate to="/" replace />} />
        <Route path="/" element={<AppShell><AppsPage /></AppShell>} />
        <Route path="/apps/new" element={<RequireMember><AppShell><NewAppPage /></AppShell></RequireMember>} />
        <Route path="/apps/:id" element={<RequireAuth><AppShell><AppDetailPage /></AppShell></RequireAuth>} />
        <Route path="/users" element={<RequireAdmin><AppShell><UsersPage /></AppShell></RequireAdmin>} />
        <Route path="/events" element={<RequireAdmin><AppShell><EventsPage /></AppShell></RequireAdmin>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
};
