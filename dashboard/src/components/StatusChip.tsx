import { Chip } from '@mui/material';
import type { AppStatus, CertStatus, DeploymentStatus } from '../api/types';

const MAP: Record<string, { color: 'default' | 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info' }> = {
  live: { color: 'success' },
  created: { color: 'info' },
  building: { color: 'primary' },
  fetching: { color: 'primary' },
  deploying: { color: 'primary' },
  queued: { color: 'default' },
  stopped: { color: 'warning' },
  failed: { color: 'error' },
  pending: { color: 'warning' },
  issued: { color: 'success' },
};

export const StatusChip = ({ status }: { status: AppStatus | DeploymentStatus | CertStatus | string }) => (
  <Chip size="small" label={status} color={MAP[status]?.color ?? 'default'} />
);
