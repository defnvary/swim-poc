import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { run, type RunResult } from '../lib/exec.js';
import { appDir, srcDir } from './docker.js';

// fetchSource — clone-or-reset into /data/apps/<slug>/src (07 §3).
// The PAT exists only inside the clone URL; every invocation redacts it (10 §7).

export interface SourceMeta {
  sha: string;
  message: string;
  author: string;
}

export interface FetchOptions {
  onLine?: (line: string) => void;
  signal?: AbortSignal;
}

const git = (args: string[], opts: { cwd?: string; redact?: string[]; onLine?: (l: string) => void; signal?: AbortSignal } = {}) =>
  run('git', args, opts);

const metaFrom = async (src: string): Promise<SourceMeta> => {
  const sha = await git(['rev-parse', 'HEAD'], { cwd: src });
  const message = await git(['log', '-1', '--format=%s'], { cwd: src });
  const author = await git(['log', '-1', '--format=%an'], { cwd: src });
  return { sha: sha.output.trim(), message: message.output.trim(), author: author.output.trim() };
};

export const fetchSource = async (
  app: { slug: string; repoOwner: string; repoName: string; branch: string },
  pat: string | null,
  ref: string | null,
  opts: FetchOptions = {},
): Promise<SourceMeta> => {
  const src = srcDir(app.slug);
  const dir = appDir(app.slug);
  const auth = pat ? `x-access-token:${pat}@` : '';
  const url = `https://${auth}github.com/${app.repoOwner}/${app.repoName}.git`;
  const redact = pat ? [pat] : [];
  const line = (l: string) => opts.onLine?.(l);

  const first = !(await exists(join(src, '.git')));
  if (first) {
    // --depth 1 bounds disk usage; history is never needed (07 §3)
    await mkdir(dir, { recursive: true });
    const clone = await git(
      ['clone', '--depth', '1', '--branch', app.branch, url, 'src'],
      { cwd: dir, redact, onLine: line, signal: opts.signal },
    );
    if (clone.code !== 0) throw new Error(`git clone failed (exit ${clone.code}): ${tail(clone)}`);
    if (ref) {
      // rollback/first deploy of a pinned SHA: branch HEAD was cloned, now move to the SHA
      const fetch = await git(['fetch', '--depth', '1', 'origin', ref], { cwd: src, redact, onLine: line, signal: opts.signal });
      if (fetch.code !== 0) throw new Error(`git fetch failed (exit ${fetch.code}): ${tail(fetch)}`);
      const reset = await git(['reset', '--hard', 'FETCH_HEAD'], { cwd: src, redact, onLine: line });
      if (reset.code !== 0) throw new Error(`git reset failed (exit ${reset.code}): ${tail(reset)}`);
    }
  } else {
    const target = ref ?? app.branch;
    const fetch = await git(['fetch', '--depth', '1', 'origin', target], { cwd: src, redact, onLine: line, signal: opts.signal });
    if (fetch.code !== 0) throw new Error(`git fetch failed (exit ${fetch.code}): ${tail(fetch)}`);
    const reset = await git(['reset', '--hard', ref ?? 'FETCH_HEAD'], { cwd: src, redact, onLine: line });
    if (reset.code !== 0) throw new Error(`git reset failed (exit ${reset.code}): ${tail(reset)}`);
    await git(['clean', '-fd'], { cwd: src, onLine: line });
  }
  return metaFrom(src);
};

const exists = async (path: string): Promise<boolean> =>
  access(path)
    .then(() => true)
    .catch(() => false);

const tail = (res: RunResult): string => res.output.split('\n').slice(-5).join('\n');
