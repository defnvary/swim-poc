// first-run admin creation (06 §3 — public only while zero users exist)
import { Box, Button, Paper, TextField, Typography } from '@mui/material';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useNavigate, Link } from 'react-router';
import { useState } from 'react';
import { apiAuth } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const schema = z.object({ username: z.string().min(1), password: z.string().min(10) });
type Form = z.infer<typeof schema>;

export const SetupPage = () => {
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { register, handleSubmit } = useForm<Form>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await apiAuth.setup(values);
      await login(values.username, values.password);
      navigate('/', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  });

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
      <Paper sx={{ p: 3, maxWidth: 380, width: '100%' }} elevation={3}>
        <Typography variant="h5" gutterBottom>Swim — first run</Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>Create the admin account.</Typography>
        <Box component="form" onSubmit={onSubmit} noValidate>
          <TextField label="Username" fullWidth margin="normal" {...register('username')} />
          <TextField label="Password (10+ chars)" fullWidth margin="normal" type="password" {...register('password')} />
          {error && <Typography color="error">{error}</Typography>}
          <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }}>Create admin</Button>
        </Box>
        <Typography variant="body2" sx={{ mt: 2 }}>
          Already set up? <Link to="/login">Log in</Link>
        </Typography>
      </Paper>
    </Box>
  );
};
