// domains + cert status + verify action, add/remove for members+ (06 §8)
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import VerifiedIcon from '@mui/icons-material/Verified';
import {
  Button, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSnackbar } from 'notistack';
import { apiDomains } from '../api/client';
import type { Domain } from '../api/types';
import { StatusChip } from './StatusChip';

export const DomainTable = ({ appId, canWrite }: { appId: string; canWrite: boolean }) => {
  const { data: domains, isPending } = useQuery({ queryKey: ['domains', appId], queryFn: () => apiDomains.list(appId) as Promise<Domain[]> });
  const [host, setHost] = useState('');
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['domains', appId] });
  const onError = (e: Error) => enqueueSnackbar(e.message, { variant: 'error' });

  const add = useMutation({
    mutationFn: () => apiDomains.add(appId, host) as Promise<Domain>,
    onSuccess: () => { setHost(''); invalidate(); enqueueSnackbar('domain added — issuing cert', { variant: 'success' }); },
    onError,
  });
  const verify = useMutation({
    mutationFn: (id: string) => apiDomains.verify(id) as Promise<{ certStatus: string; dns: { pointsToServer?: boolean } }>,
    onSuccess: (res) => { invalidate(); enqueueSnackbar(`verify: ${res.certStatus}${res.dns.pointsToServer === false ? ' (DNS does not point here)' : ''}`, { variant: 'info' }); },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDomains.remove(id),
    onSuccess: invalidate,
    onError,
  });

  if (isPending) return <Typography>Loading…</Typography>;
  return (
    <Stack spacing={1}>
      <Table size="small">
        <TableHead>
          <TableRow><TableCell>Host</TableCell><TableCell>Cert</TableCell><TableCell>Issued</TableCell><TableCell align="right">Actions</TableCell></TableRow>
        </TableHead>
        <TableBody>
          {(domains ?? []).map((d) => (
            <TableRow key={d.id}>
              <TableCell sx={{ fontFamily: 'monospace' }}>{d.host}</TableCell>
              <TableCell><StatusChip status={d.certStatus} /></TableCell>
              <TableCell>{d.certIssuedAt ?? '—'}</TableCell>
              <TableCell align="right">
                {canWrite && (
                  <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                    <Button size="small" startIcon={<VerifiedIcon />} onClick={() => verify.mutate(d.id)} disabled={verify.isPending}>Verify</Button>
                    <Button size="small" color="error" aria-label="remove domain" onClick={() => remove.mutate(d.id)}><DeleteIcon fontSize="small" /></Button>
                  </Stack>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {canWrite && (
        <Stack direction="row" spacing={1}>
          <TextField size="small" placeholder="myapp.example.com" value={host} onChange={(e) => setHost(e.target.value)} sx={{ flex: 1 }} />
          <Button startIcon={<AddIcon />} variant="outlined" size="small" disabled={!host || add.isPending} onClick={() => add.mutate()}>Add domain</Button>
        </Stack>
      )}
    </Stack>
  );
};
