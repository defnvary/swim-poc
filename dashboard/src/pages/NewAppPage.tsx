// 3-step wizard: repo → build config → webhook summary (04 §1)
import { Box, Button, Paper, Step, StepLabel, Stepper, TextField, Typography, MenuItem, Switch, FormControlLabel } from '@mui/material';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { apiApps } from '../api/client';
import type { AppFull, Webhook } from '../api/types';
import { SecretField } from '../components/SecretField';

const schema = z.object({
  repoOwner: z.string().regex(/^[A-Za-z0-9-]+$/),
  repoName: z.string().regex(/^[A-Za-z0-9._-]+$/),
  branch: z.string().regex(/^[A-Za-z0-9._/-]+$/),
  accessToken: z.string(),
  name: z.string().min(1).max(50),
  port: z.number().int().min(1).max(65535),
  healthcheckPath: z.string().regex(/^\//),
  buildType: z.enum(['auto', 'dockerfile', 'node', 'static']),
  autoDeploy: z.boolean(),
});
type Form = z.infer<typeof schema>;

const STEPS = [
  { title: 'Repository', fields: ['repoOwner', 'repoName', 'branch', 'accessToken'] as (keyof Form)[] },
  { title: 'Build config', fields: ['name', 'port', 'healthcheckPath', 'buildType', 'autoDeploy'] as (keyof Form)[] },
  { title: 'Create', fields: [] as (keyof Form)[] },
];

export const NewAppPage = () => {
  const [step, setStep] = useState(0);
  const [created, setCreated] = useState<{ app: AppFull; webhook: Webhook } | null>(null);
  const { register, control, handleSubmit, trigger, getValues, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { branch: 'main', port: 3000, healthcheckPath: '/', buildType: 'auto', autoDeploy: true, accessToken: '', repoOwner: '', repoName: '', name: '' },
  });

  const create = handleSubmit(async (v) => {
    const body: Record<string, unknown> = { ...v, accessToken: v.accessToken || undefined };
    if (!body.accessToken) delete body.accessToken;
    const res = (await apiApps.create(body)) as AppFull & { webhook: Webhook };
    setCreated({ app: res, webhook: res.webhook });
  });

  const next = async () => {
    if (STEPS[step]!.fields.length === 0 || (await trigger(STEPS[step]!.fields))) setStep(step + 1);
  };

  if (created) {
    return (
      <Paper sx={{ p: 3, maxWidth: 640, mx: 'auto' }}>
        <Typography variant="h5" gutterBottom>App created</Typography>
        <Typography sx={{ mb: 2 }}>
          This is the <strong>only time</strong> the webhook secret is shown. Add the webhook in GitHub →
          Settings → Webhooks with the URL and secret below (content type: JSON).
        </Typography>
        <SecretField label="Webhook URL" value={created.webhook.url} />
        <Box sx={{ mt: 1 }} />
        <SecretField label="Webhook secret" value={created.webhook.secret} />
        <Button component={Link} to={`/apps/${created.app.id}`} variant="contained" sx={{ mt: 3 }}>Open {created.app.name}</Button>
      </Paper>
    );
  }

  const err = (k: keyof Form) => ({ error: Boolean(errors[k]), helperText: errors[k]?.message?.toString() });

  return (
    <Box sx={{ maxWidth: 640, mx: 'auto' }}>
      <Stepper activeStep={step} alternativeLabel sx={{ mb: 3 }}>
        {STEPS.map((s) => <Step key={s.title}><StepLabel>{s.title}</StepLabel></Step>)}
      </Stepper>
      <Paper sx={{ p: 3 }} component="form" onSubmit={create} elevation={2}>
        {step === 0 && (
          <>
            <TextField label="Repo owner" fullWidth margin="normal" {...register('repoOwner')} {...err('repoOwner')} />
            <TextField label="Repo name" fullWidth margin="normal" {...register('repoName')} {...err('repoName')} />
            <TextField label="Branch" fullWidth margin="normal" {...register('branch')} {...err('branch')} />
            <TextField label="Access token (PAT — leave empty for public repos)" fullWidth margin="normal" type="password" {...register('accessToken')} />
          </>
        )}
        {step === 1 && (
          <>
            <TextField label="App name" fullWidth margin="normal" {...register('name')} {...err('name')} />
            <TextField label="Port" fullWidth margin="normal" type="number" {...register('port', { valueAsNumber: true })} {...err('port')} />
            <TextField label="Healthcheck path" fullWidth margin="normal" {...register('healthcheckPath')} {...err('healthcheckPath')} />
            <Controller
              name="buildType"
              control={control}
              render={({ field }) => (
                <TextField label="Build type" select fullWidth margin="normal" name={field.name} value={field.value} onChange={field.onChange} onBlur={field.onBlur} inputRef={field.ref}>
                  {['auto', 'dockerfile', 'node', 'static'].map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </TextField>
              )}
            />
            <FormControlLabel control={<Switch {...register('autoDeploy')} />} label="Auto-deploy on push" />
          </>
        )}
        {step === 2 && (
          <>
            <Typography variant="h6" gutterBottom>Review</Typography>
            {(['repoOwner', 'repoName', 'branch', 'name', 'port', 'healthcheckPath', 'buildType', 'autoDeploy'] as const).map((k) => (
              <Typography key={k} variant="body2">{k}: <code>{String(getValues(k))}</code></Typography>
            ))}
            <Typography variant="body2" sx={{ mt: 1 }}>
              A default <code>&lt;slug&gt;.&lt;SWIM_DOMAIN&gt;</code> domain is created with the app.
            </Typography>
          </>
        )}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
          <Button onClick={() => (step === 0 ? undefined : setStep(step - 1))} disabled={step === 0}>Back</Button>
          {step < 2
            ? <Button variant="contained" onClick={() => void next()}>Next</Button>
            : <Button type="submit" variant="contained">Create app</Button>}
        </Box>
      </Paper>
    </Box>
  );
};
