import { Box, Button, Typography } from '@mui/material';
import type { ReactNode } from 'react';

export const EmptyState = ({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) => (
  <Box sx={{ textAlign: 'center', py: 8 }}>
    <Typography variant="h6" color="text.secondary">{title}</Typography>
    {hint && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{hint}</Typography>}
    {action && <Box sx={{ mt: 2 }}>{action}</Box>}
  </Box>
);

export const ErrorText = ({ error }: { error: unknown }) =>
  error ? (
    <Typography color="error" variant="body2" sx={{ my: 1 }}>
      {error instanceof Error ? error.message : String(error)}
    </Typography>
  ) : null;

export const Loading = () => <Typography sx={{ p: 2 }}>Loading…</Typography>;

export const PageHeader = ({ title, actions }: { title: string; actions?: ReactNode }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 2 }}>
    <Typography variant="h5" sx={{ flexGrow: 1 }}>{title}</Typography>
    {actions}
  </Box>
);

export const PaginationRow = ({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (p: number) => void }) =>
  total > limit ? (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 2 }}>
      <Button size="small" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <Typography variant="body2">{page} / {Math.max(1, Math.ceil(total / limit))}</Typography>
      <Button size="small" disabled={page * limit >= total} onClick={() => onPage(page + 1)}>Next</Button>
    </Box>
  ) : null;
