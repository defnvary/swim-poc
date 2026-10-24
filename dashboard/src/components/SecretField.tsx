// reveal/copy for the webhook secret and PAT last4 (04 §1)
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { Box, IconButton, TextField } from '@mui/material';
import { useState } from 'react';

export const SecretField = ({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) => {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
      <TextField
        size="small"
        label={label}
        value={revealed ? value : '•'.repeat(Math.min(value.length, 24))}
        slotProps={{ input: { readOnly: true, sx: mono ? { fontFamily: 'monospace', fontSize: '0.8rem' } : undefined } }}
        sx={{ flex: 1, minWidth: 0 }}
      />
      <IconButton size="small" onClick={() => setRevealed((r) => !r)} aria-label="reveal">
        {revealed ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
      </IconButton>
      <IconButton size="small" aria-label="copy" onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}>
        <ContentCopyIcon fontSize="small" />
      </IconButton>
      {copied && 'copied'}
    </Box>
  );
};
