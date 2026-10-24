// tabs: Overview | Deployments | Logs | Environment | Domains | Settings (04 §1)
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  FormControlLabel, MenuItem, Stack, Switch, Tab, Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router';
import { useSnackbar } from 'notistack';
import { apiApps, apiDeployments } from '../api/client';
import type { AppFull, Deployment, Paginated } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { DeploymentTimeline } from '../components/DeploymentTimeline';
import { DomainTable } from '../components/DomainTable';
import { EmptyState, ErrorText, Loading, PageHeader } from '../components/EmptyState';
import { EnvEditor } from '../components/EnvEditor';
import { LogViewer } from '../components/LogViewer';
import { SecretField } from '../components/SecretField';
import { StatusChip } from '../components/StatusChip';

const ACTIVE = ['queued', 'fetching', 'building', 'deploying'];

const Fact = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <Typography variant="body2" component="div"><strong>{k}:</strong> {v}</Typography>
);

const SettingsForm = ({ app }: { app: AppFull }) => {
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const navigate = useNavigate();
  const [hook, setHook] = useState<{ url: string; secret: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { register, control, handleSubmit } = useForm({
    defaultValues: {
      name: app.name, repoOwner: app.repoOwner, repoName: app.repoName, branch: app.branch,
      port: app.port, healthcheckPath: app.healthcheckPath, buildType: app.buildType,
      autoDeploy: app.autoDeploy, accessToken: '',
    },
  });
  const save = handleSubmit((v) =>
    apiApps.patch(app.id, { ...v, port: Number(v.port), accessToken: v.accessToken || undefined })
      .then(() => { qc.invalidateQueries({ queryKey: ['app', app.id] }); enqueueSnackbar('saved', { variant: 'success' }); })
      .catch((e: Error) => enqueueSnackbar(e.message, { variant: 'error' })));
  const rotate = useMutation({
    mutationFn: () => apiApps.rotateHook(app.id),
    onSuccess: (r) => setHook(r.webhook),
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  });
  const del = useMutation({
    mutationFn: () => apiApps.remove(app.id),
    onSuccess: () => navigate('/', { replace: true }),
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  });

  return (
    <Box component="form" onSubmit={save}>
      <Stack spacing={2} direction="row" sx={{ flexWrap: 'wrap' }}>
        <TextField size="small" label="Name" {...register('name')} sx={{ width: 220 }} />
        <TextField size="small" label="Repo owner" {...register('repoOwner')} sx={{ width: 160 }} />
        <TextField size="small" label="Repo name" {...register('repoName')} sx={{ width: 160 }} />
        <TextField size="small" label="Branch" {...register('branch')} sx={{ width: 140 }} />
        <TextField size="small" label="Port" type="number" {...register('port')} sx={{ width: 100 }} />
        <TextField size="small" label="Healthcheck path" {...register('healthcheckPath')} sx={{ width: 150 }} />
        <Controller
          name="buildType"
          control={control}
          render={({ field }) => (
            <TextField size="small" label="Build type" select sx={{ width: 130 }} name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} inputRef={field.ref}>
              {['auto', 'dockerfile', 'node', 'static'].map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </TextField>
          )}
        />
      </Stack>
      <Stack spacing={1} sx={{ mt: 2 }}>
        <FormControlLabel control={<Switch {...register('autoDeploy')} />} label="Auto-deploy on push" />
        <TextField size="small" label="New access token (leave empty to keep)" type="password" sx={{ maxWidth: 360 }} {...register('accessToken')} />
        <Box><Button variant="contained" type="submit">Save</Button></Box>
      </Stack>
      <Box sx={{ mt: 3 }}>
        <Typography variant="subtitle2">Webhook</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Rotating issues a new hook id and secret; the old URL stops working immediately.</Typography>
        <Button size="small" variant="outlined" onClick={() => rotate.mutate()} disabled={rotate.isPending}>
          {rotate.isPending ? 'Rotating…' : 'Rotate webhook'}
        </Button>
        {hook && (
          <Stack spacing={1} sx={{ mt: 1, maxWidth: 560 }}>
            <SecretField label="New URL" value={hook.url} />
            <SecretField label="New secret" value={hook.secret} />
          </Stack>
        )}
      </Box>
      <Box sx={{ mt: 3 }}>
        <Typography variant="subtitle2" color="error">Danger zone</Typography>
        <Button size="small" color="error" variant="outlined" onClick={() => setConfirmDelete(true)}>Delete app</Button>
        <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
          <DialogTitle>Delete {app.slug}?</DialogTitle>
          <DialogContent><DialogContentText>Container, vhosts, data and history are removed. This cannot be undone.</DialogContentText></DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button color="error" onClick={() => del.mutate()}>Delete</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </Box>
  );
};

export const AppDetailPage = () => {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { enqueueSnackbar } = useSnackbar();
  const qc = useQueryClient();
  const [tab, setTab] = useState(0);
  const canWrite = user?.role === 'member' || user?.role === 'admin';

  const { data: app, isPending, error } = useQuery({
    queryKey: ['app', id],
    queryFn: () => apiApps.get(id) as Promise<AppFull>,
    refetchInterval: (q) => (ACTIVE.includes(q.state.data?.status ?? '') ? 3000 : false),
  });
  const { data: deps } = useQuery({
    queryKey: ['deployments', id],
    queryFn: () => apiDeployments.list(id, 1, 20) as Promise<Paginated<Deployment>>,
    refetchInterval: (q) => (q.state.data?.data.some((d) => ACTIVE.includes(d.status)) ? 2000 : false),
  });

  const deploy = useMutation({
    mutationFn: (sha?: string) => apiDeployments.create(id, sha) as Promise<{ deployment: Deployment }>,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['deployments', id] }); qc.invalidateQueries({ queryKey: ['app', id] }); },
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  });
  const power = useMutation({
    mutationFn: (on: boolean) => (on ? apiApps.start(id) : apiApps.stop(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app', id] }),
    onError: (e: Error) => enqueueSnackbar(e.message, { variant: 'error' }),
  });

  if (isPending) return <Loading />;
  if (error || !app) return <ErrorText error={error} />;
  const running = deps?.data.find((d) => ACTIVE.includes(d.status)) ?? null;
  const titles = ['Overview', 'Deployments', 'Logs', 'Environment', 'Domains', 'Settings'];

  return (
    <Box>
      <PageHeader
        title={app.name}
        actions={
          <Stack direction="row" spacing={1}>
            <StatusChip status={app.status} />
            {canWrite && (
              <>
                <Tooltip title={app.currentDeploymentId ? 'Deploy branch HEAD' : ''}>
                  <span><Button variant="contained" size="small" disabled={!!running || deploy.isPending} onClick={() => deploy.mutate()}>
                    {deploy.isPending ? 'Deploying…' : 'Deploy'}
                  </Button></span>
                </Tooltip>
                {app.status === 'stopped'
                  ? <Button size="small" onClick={() => power.mutate(true)} disabled={power.isPending}>Start</Button>
                  : <Button size="small" onClick={() => power.mutate(false)} disabled={power.isPending || !['live', 'created'].includes(app.status)}>Stop</Button>}
              </>
            )}
          </Stack>
        }
      />
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 2 }}>
        {titles.map((t) => <Tab key={t} label={t} />)}
      </Tabs>

      {tab === 0 && (
        <Stack spacing={0.5}>
          <Fact k="slug" v={<code>{app.slug}</code>} />
          <Fact k="repo" v={<code>{app.repoOwner}/{app.repoName}@{app.branch}</code>} />
          <Fact k="port / healthcheck" v={`${app.port} ${app.healthcheckPath}`} />
          <Fact k="build" v={`${app.buildType} · autoDeploy ${app.autoDeploy}`} />
          <Fact k="repo token" v={app.hasToken ? `set (…${app.tokenLast4})` : 'none (public repo)'} />
          {app.currentDeployment
            ? <Fact k="current" v={<Stack direction="row" spacing={1} sx={{ display: 'inline-flex' }}><code>{app.currentDeployment.commitSha.slice(0, 7)}</code><StatusChip status={app.currentDeployment.status} /><span>{app.currentDeployment.commitMessage}</span></Stack>} />
            : <Fact k="current" v="never deployed" />}
          <Fact k="domains" v={(app.domains ?? []).map((d) => d.host).join(', ') || '—'} />
        </Stack>
      )}
      {tab === 1 && (
        <>
          {running && <LogViewer key={running.id} url={`/api/deployments/${running.id}/logs?tail=500&follow=1`} onDone={() => qc.invalidateQueries({ queryKey: ['deployments', id] })} />}
          {(deps?.data.length ?? 0) === 0 && !running && <EmptyState title="No deployments yet" />}
          <Box sx={{ mt: running ? 2 : 0 }}>
            <DeploymentTimeline deployments={deps?.data ?? []} canDeploy={canWrite} onRollback={(sha) => deploy.mutate(sha)} />
          </Box>
        </>
      )}
      {tab === 2 && <LogViewer url={`/api/apps/${id}/logs?tail=300&follow=1`} />}
      {tab === 3 && <EnvEditor appId={id} canWrite={canWrite} />}
      {tab === 4 && <DomainTable appId={id} canWrite={canWrite} />}
      {tab === 5 && <SettingsForm app={app} />}
    </Box>
  );
};
