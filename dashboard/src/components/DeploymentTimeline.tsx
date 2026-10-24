// Deployment history as a timeline with rollback-to-commit (06 §6 POST {commitSha}).
import ReplayIcon from '@mui/icons-material/Replay';
import { Button, Divider, List, ListItem, Stack, Typography } from '@mui/material';
import dayjs from 'dayjs';
import type { Deployment } from '../api/types';
import { StatusChip } from './StatusChip';

export const DeploymentTimeline = ({
  deployments,
  canDeploy,
  onRollback,
}: {
  deployments: Deployment[];
  canDeploy: boolean;
  onRollback: (commitSha: string) => void;
}) => (
  <List>
    {deployments.map((d, i) => (
      <div key={d.id}>
        {i > 0 && <Divider component="li" />}
        <ListItem alignItems="flex-start" disableGutters>
          <Stack direction="row" spacing={1} sx={{ width: '100%', alignItems: 'center' }}>
            <Typography variant="body2" sx={{ width: 130, flexShrink: 0 }} color="text.secondary">
              {dayjs(d.createdAt).format('MMM D HH:mm')}
            </Typography>
            <StatusChip status={d.status} />
            <Typography variant="body2" sx={{ minWidth: 0 }} noWrap>
              <code>{d.commitSha.slice(0, 7)}</code> {d.commitMessage ?? '(no message)'} · {d.author ?? d.trigger}
              {d.triggeredBy && ` (${d.triggeredBy})`}
            </Typography>
            <Button
              size="small"
              startIcon={<ReplayIcon />}
              disabled={!canDeploy || d.status !== 'live' || i === 0}
              onClick={() => onRollback(d.commitSha)}
              sx={{ ml: 'auto', flexShrink: 0 }}
            >
              Rollback
            </Button>
          </Stack>
        </ListItem>
        {d.error && (
          <Typography variant="caption" color="error" component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap' }}>
            {d.error}
          </Typography>
        )}
      </div>
    ))}
  </List>
);
