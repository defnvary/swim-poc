// grid of app cards + status (04 §1)
import AddIcon from '@mui/icons-material/Add';
import { Box, Button, Card, CardActionArea, Grid, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { apiApps } from '../api/client';
import type { AppSummary, Paginated } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, ErrorText, Loading, PageHeader, PaginationRow } from '../components/EmptyState';
import { StatusChip } from '../components/StatusChip';

export const AppsPage = () => {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const { data, isPending, error } = useQuery({
    queryKey: ['apps', page],
    queryFn: () => apiApps.list(page) as Promise<Paginated<AppSummary>>,
  });
  const canCreate = user?.role === 'member' || user?.role === 'admin';

  return (
    <Box>
      <PageHeader
        title="Apps"
        actions={canCreate && <Button variant="contained" startIcon={<AddIcon />} component={Link} to="/apps/new">New app</Button>}
      />
      <ErrorText error={error} />
      {isPending && <Loading />}
      {data && data.data.length === 0 && (
        <EmptyState title="No apps yet" hint="Deploy your first app on this server." action={canCreate && <Button component={Link} to="/apps/new" variant="contained">New app</Button>} />
      )}
      <Grid container spacing={2}>
        {(data?.data ?? []).map((a) => (
          <Grid key={a.id} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card>
              <CardActionArea component={Link} to={`/apps/${a.id}`} sx={{ p: 2, display: 'block' }}>
                <Typography variant="h6" noWrap>{a.name}</Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {a.repoOwner}/{a.repoName}@{a.branch}
                </Typography>
                <StatusChip status={a.status} />
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
      {data && <PaginationRow page={data.meta.page} limit={data.meta.limit} total={data.meta.total} onPage={setPage} />}
    </Box>
  );
};
