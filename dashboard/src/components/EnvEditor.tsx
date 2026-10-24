// key/value editor, replace-all PUT with optional applyNow (06 §9)
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { Box, Button, Checkbox, FormControlLabel, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSnackbar } from 'notistack';
import { apiEnv } from '../api/client';
import type { EnvRow } from '../api/types';

interface Draft { key: string; value: string }

export const EnvEditor = ({ appId, canWrite }: { appId: string; canWrite: boolean }) => {
  const { data, isPending } = useQuery({ queryKey: ['env', appId], queryFn: () => apiEnv.get(appId) as Promise<EnvRow[]> });
  const [rows, setRows] = useState<Draft[] | null>(null); // null until first data lands
  const [applyNow, setApplyNow] = useState(false);
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();

  const effective: Draft[] =
    rows ??
    (data ?? []).map((r) => ({ key: r.key, value: r.value ?? '' }));

  const save = useMutation({
    mutationFn: () => apiEnv.put(appId, effective.filter((r) => r.key), applyNow) as Promise<{ applied: number; redeployTriggered: boolean }>,
    onSuccess: (res) => {
      setRows(null);
      qc.invalidateQueries({ queryKey: ['env', appId] });
      enqueueSnackbar(`applied ${res.applied}${res.redeployTriggered ? ' · redeploying' : ''}`, { variant: 'success' });
    },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  });

  if (isPending) return <Typography>Loading…</Typography>;
  if (!canWrite) {
    return (
      <Box>
        {(data ?? []).length === 0 && <Typography color="text.secondary">No env vars.</Typography>}
        {(data ?? []).map((r) => (
          <Typography key={r.key} variant="body2" sx={{ fontFamily: 'monospace' }}>
            {r.key} = {'masked' in r && r.masked ? '••••••' : r.value}
          </Typography>
        ))}
        <Typography variant="caption" color="text.secondary">viewers cannot see values or edit</Typography>
      </Box>
    );
  }

  const setRow = (i: number, patch: Partial<Draft>) =>
    setRows(effective.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Box>
      {effective.map((r, i) => (
        <Box key={i} sx={{ display: 'flex', gap: 1, mb: 1, flexDirection: { xs: 'column', sm: 'row' } }}>
          <TextField size="small" placeholder="API_KEY" value={r.key} onChange={(e) => setRow(i, { key: e.target.value })}
            sx={{ width: { sm: 240 }, '& input': { fontFamily: 'monospace' } }} />
          <TextField size="small" value={r.value} onChange={(e) => setRow(i, { value: e.target.value })}
            sx={{ flex: 1, '& input': { fontFamily: 'monospace' } }} />
          <Button size="small" onClick={() => setRows(effective.filter((_, j) => j !== i))} aria-label="remove">
            <DeleteIcon fontSize="small" />
          </Button>
        </Box>
      ))}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mt: 1, flexWrap: 'wrap' }}>
        <Button size="small" startIcon={<AddIcon />} onClick={() => setRows([...effective, { key: '', value: '' }])}>
          Add row
        </Button>
        <FormControlLabel
          control={<Checkbox checked={applyNow} onChange={(e) => setApplyNow(e.target.checked)} size="small" />}
          label="apply now (redeploy)"
        />
        <Button variant="contained" size="small" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </Box>
    </Box>
  );
};
