import { spawn } from 'node:child_process';

export interface RunResult {
  code: number | null;
  output: string;
}

export interface RunOptions {
  onLine?: (line: string) => void;
  redact?: string[];
  signal?: AbortSignal;
  cwd?: string;
}

// The only place child processes spawn — fixed argument arrays, never a shell (03 §6.6, 10 §7)
export const run = (cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { signal: opts.signal, cwd: opts.cwd });
    const lines: string[] = [];

    const emit = (raw: string) => {
      const line = opts.redact?.some((s) => s && raw.includes(s)) ? '[REDACTED]' : raw;
      lines.push(line);
      opts.onLine?.(line);
    };

    const pipe = (stream: NodeJS.ReadableStream | null) => {
      if (!stream) return;
      let buf = '';
      stream.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          emit(buf.slice(0, nl).replace(/\r$/, ''));
          buf = buf.slice(nl + 1);
        }
      });
      stream.on('end', () => {
        if (buf) emit(buf);
      });
    };

    pipe(child.stdout);
    pipe(child.stderr);
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output: lines.join('\n') }));
  });
