import { Box, Button, Paper, TextField, Typography } from '@mui/material';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import { useAuth } from '../auth/AuthContext';

const schema = z.object({ username: z.string().min(1), password: z.string().min(1) });

export const LoginPage = () => {
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { register, handleSubmit } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async ({ username, password }) => {
    setError(null);
    try {
      await login(username, password);
      navigate('/', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  });

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
      <Paper sx={{ p: 3, maxWidth: 380, width: '100%' }} elevation={3}>
        <Typography variant="h5" gutterBottom>Swim</Typography>
        <Box component="form" onSubmit={onSubmit} noValidate>
          <TextField label="Username" fullWidth margin="normal" {...register('username')} />
          <TextField label="Password" fullWidth margin="normal" type="password" {...register('password')} />
          {error && <Typography color="error">{error}</Typography>}
          <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }}>Log in</Button>
        </Box>
        <Typography variant="body2" sx={{ mt: 2 }}>
          First run? <Link to="/setup">Create the admin account</Link>
        </Typography>
      </Paper>
    </Box>
  );
};
