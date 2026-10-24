// admin user CRUD (06 §4)
import AddIcon from '@mui/icons-material/Add';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem,
  Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { useState } from 'react';
import { z } from 'zod';
import { useSnackbar } from 'notistack';
import { apiUsers } from '../api/client';
import type { Paginated, Role, User } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ErrorText, Loading, PageHeader, PaginationRow } from '../components/EmptyState';

const schema = z.object({ username: z.string().min(1), password: z.string().min(10), role: z.enum(['viewer', 'member', 'admin']) });

export const UsersPage = () => {
  const { user: me } = useAuth();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { data, isPending, error } = useQuery({
    queryKey: ['users', page],
    queryFn: () => apiUsers.list(page) as Promise<Paginated<User>>,
  });
  const { register, control, handleSubmit, reset } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { role: 'viewer' } });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });
  const onError = (e: Error) => enqueueSnackbar(e.message, { variant: 'error' });

  const create = useMutation({
    mutationFn: (v: z.infer<typeof schema>) => apiUsers.create(v),
    onSuccess: () => { setOpen(false); reset(); invalidate(); enqueueSnackbar('user created', { variant: 'success' }); },
    onError,
  });
  const patch = useMutation({
    mutationFn: ({ id, patch: p }: { id: string; patch: { role?: Role; active?: boolean } }) => apiUsers.patch(id, p),
    onSuccess: invalidate,
    onError,
  });
  const remove = useMutation({ mutationFn: (id: string) => apiUsers.remove(id), onSuccess: invalidate, onError });

  return (
    <Box>
      <PageHeader title="Users" actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>New user</Button>} />
      <ErrorText error={error} />
      {isPending && <Loading />}
      {data && (
        <>
          <Table size="small">
            <TableHead>
              <TableRow><TableCell>Username</TableCell><TableCell>Role</TableCell><TableCell>Active</TableCell><TableCell>Created</TableCell><TableCell align="right" /></TableRow>
            </TableHead>
            <TableBody>
              {data.data.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>{u.username}{u.id === me?.id && ' (you)'}</TableCell>
                  <TableCell>
                    <TextField select size="small" value={u.role} sx={{ minWidth: 110 }}
                      onChange={(e) => patch.mutate({ id: u.id, patch: { role: e.target.value as Role } })}>
                      {['viewer', 'member', 'admin'].map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
                    </TextField>
                  </TableCell>
                  <TableCell>
                    <Button size="small" onClick={() => patch.mutate({ id: u.id, patch: { active: !u.active } })}>
                      {u.active === false ? 'Deactivated' : 'Active'}
                    </Button>
                  </TableCell>
                  <TableCell>{new Date(u.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell align="right">
                    <Button size="small" color="error" onClick={() => remove.mutate(u.id)} disabled={u.id === me?.id}>Deactivate</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PaginationRow page={data.meta.page} limit={data.meta.limit} total={data.meta.total} onPage={setPage} />
        </>
      )}
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>New user</DialogTitle>
        <Box component="form" onSubmit={handleSubmit((v) => create.mutate(v))}>
          <DialogContent>
            <Stack spacing={2}>
              <TextField size="small" label="Username" {...register('username')} />
              <TextField size="small" label="Password (10+ chars)" type="password" {...register('password')} />
              <Controller
                name="role"
                control={control}
                render={({ field }) => (
                  <TextField size="small" select label="Role" name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} inputRef={field.ref}>
                    {['viewer', 'member', 'admin'].map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
                  </TextField>
                )}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained">Create</Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Box>
  );
};
