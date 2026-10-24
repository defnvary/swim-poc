// AppBar + Drawer layout, user menu, theme toggle (04 §1). Responsive to 375 px:
// permanent Drawer on md+, temporary on small screens.
import MenuIcon from '@mui/icons-material/Menu';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import LogoutIcon from '@mui/icons-material/Logout';
import {
  AppBar, Box, Drawer, IconButton, List, ListItemButton, ListItemText, Menu, MenuItem,
  Toolbar, Typography, Button,
} from '@mui/material';
import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { useThemeMode } from '../main';

const DRAWER_WIDTH = 220;

const navItems = [
  { label: 'Apps', to: '/' },
  { label: 'Users', to: '/users', adminOnly: true },
  { label: 'Events', to: '/events', adminOnly: true },
];

export const AppShell = ({ children }: { children: ReactNode }) => {
  const { user, logout } = useAuth();
  const { mode, toggle } = useThemeMode();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const navigate = useNavigate();

  const items = navItems.filter((i) => !i.adminOnly || user?.role === 'admin');
  const nav = (
    <List>
      {items.map((i) => (
        <ListItemButton key={i.to} component={NavLink} to={i.to} end={i.to === '/'} onClick={() => setMobileOpen(false)}
          sx={({ palette }) => ({ '&.active': { bgcolor: palette.action.hover, fontWeight: 600 } })}>
          <ListItemText primary={i.label} />
        </ListItemButton>
      ))}
    </List>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" color="default" elevation={1}>
        <Toolbar variant="dense">
          <IconButton edge="start" aria-label="menu" sx={{ mr: 1, md: 'hidden' }} onClick={() => setMobileOpen(true)}>
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" sx={{ flexGrow: 1 }} onClick={() => navigate('/')}>
            Swim
          </Typography>
          <IconButton onClick={toggle} aria-label="theme" color="inherit">
            {mode === 'dark' ? <Brightness7Icon /> : <Brightness4Icon />}
          </IconButton>
          <Button color="inherit" onClick={({ currentTarget }) => setMenuAnchor(currentTarget)}>
            {user?.username}
          </Button>
          <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
            <MenuItem disabled>{user?.role}</MenuItem>
            <MenuItem onClick={() => void logout()}>
              <LogoutIcon fontSize="small" sx={{ mr: 1 }} /> Log out
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>
      <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
        <Drawer variant="temporary" open={mobileOpen} onClose={() => setMobileOpen(false)} ModalProps={{ keepMounted: true }}
          sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}>
          {nav}
        </Drawer>
        <Drawer variant="permanent" open sx={{ display: { xs: 'none', md: 'block' }, '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' } }}>
          <Toolbar variant="dense" />
          {nav}
        </Drawer>
      </Box>
      <Box component="main" sx={{ flexGrow: 1, p: { xs: 2, md: 3 }, width: { md: `calc(100% - ${DRAWER_WIDTH}px)` } }}>
        <Toolbar variant="dense" />
        {children}
      </Box>
    </Box>
  );
};
