// SSE terminal-style viewer with pause/follow (04 §1) — used for both deploy and runtime logs.
import { Box, Button, Stack } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { streamSSE } from '../api/sse';
import { StatusChip } from './StatusChip';

const MAX_LINES = 5000;

export const LogViewer = ({ url, onDone }: { url: string; onDone?: () => void }) => {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const ac = new AbortController();
    setLines([]);
    setStatus(null);
    setError(null);
    void streamSSE(
      url,
      {
        onLog: (line) => setLines((prev) => [...prev.slice(-MAX_LINES + 1), line]),
        onStatus: setStatus,
        onDone: (s) => {
          setStatus(s);
          doneRef.current?.();
        },
      },
      ac.signal,
    ).catch((e: Error) => {
      if (!ac.signal.aborted) setError(e.message);
    });
    return () => ac.abort();
  }, [url]);

  useEffect(() => {
    if (follow && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [lines, follow]);

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
        {status && <StatusChip status={status} />}
        <Button size="small" onClick={() => setFollow((f) => !f)}>{follow ? 'Pause' : 'Resume'}</Button>
        {error && <Box sx={{ color: 'error.main' }}>{error}</Box>}
      </Stack>
      <Box
        ref={preRef as React.Ref<HTMLDivElement>}
        component="pre"
        sx={{
          bgcolor: '#0a0f1a', color: '#d7e2f2', p: 2, borderRadius: 1, height: 420, overflow: 'auto',
          fontFamily: 'ui-monospace, "JetBrains Mono", Menlo, monospace', fontSize: '0.78rem', lineHeight: 1.5,
          whiteSpace: 'pre-wrap', wordBreak: 'break-all', m: 0,
        }}
        data-testid="log-viewer"
      >
        {lines.length ? lines.join('\n') : '…'}
      </Box>
    </Box>
  );
};
