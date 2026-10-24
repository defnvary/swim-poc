// audit trail (06 §10) — admin only
import { Box, Button, Chip, MenuItem, TextField, Typography } from '@mui/material';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiEvents } from '../api/client';
import type { EventRow, Paginated } from '../api/types';
import { ErrorText, Loading, PageHeader, PaginationRow } from '../components/EmptyState';

const COMMON_ACTIONS = ['', 'setup.completed', 'auth.login_failed', 'app.created', 'app.deleted', 'deploy.queued', 'deploy.live', 'deploy.failed', 'hook.rotated', 'user.created'];

export const EventsPage = () => {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const { data, isPending, error } = useQuery({
    queryKey: ['events', page, action],
    queryFn: () => apiEvents.list(page, 30, action || undefined) as Promise<Paginated<EventRow>>,
  });

  return (
    <Box>
      <PageHeader
        title="Events"
        actions={
          <TextField select size="small" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} sx={{ minWidth: 190 }} label="Action">
            {COMMON_ACTIONS.map((a) => <MenuItem key={a} value={a}>{a || 'all actions'}</MenuItem>)}
          </TextField>
        }
      />
      <ErrorText error={error} />
      {isPending && <Loading />}
      {data && (
        <>
          <Table size="small">
            <TableHead>
              <TableRow><TableCell>When</TableCell><TableCell>Action</TableCell><TableCell>User</TableCell><TableCell>Target</TableCell><TableCell>Details</TableCell></TableRow>
            </TableHead>
            <TableBody>
              {data.data.map((e) => (
                <TableRow key={e.id}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{new Date(e.createdAt).toLocaleString()}</TableCell>
                  <TableCell><Chip size="small" label={e.action} /></TableCell>
                  <TableCell>{e.user?.username ?? '—'}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{e.targetType ? `${e.targetType} ${String(e.targetId).slice(0, 8)}` : '—'}</TableCell>
                  <TableCell><Details details={e.details} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PaginationRow page={data.meta.page} limit={data.meta.limit} total={data.meta.total} onPage={setPage} />
        </>
      )}
    </Box>
  );
};

const Details = ({ details }: { details: unknown }) => {
  const [open, setOpen] = useState(false);
  if (details === null || details === undefined) return <Typography variant="body2">—</Typography>;
  const text = JSON.stringify(details);
  return (
    <Button size="small" variant="text" sx={{ textTransform: 'none', justifyContent: 'flex-start', maxWidth: 260 }} onClick={() => setOpen(!open)}>
      <Typography variant="body2" noWrap component="span">{open ? text : text.slice(0, 60) + (text.length > 60 ? '…' : '')}</Typography>
    </Button>
  );
};
