import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import { pino } from 'pino';

// 04 §2 — serve the built dashboard; unknown GETs (non-/api) fall back to index.html.
// Mount after the /api routers and before the JSON 404 (04 §2 middleware order).

const log = pino({ level: 'info' });

// The image ships the dashboard at /app/dashboard-dist while this file compiles to
// /app/server/dist (08 §3) — two levels up. In the source tree it is <repo>/dashboard/dist
// (dev: server/src; built: server/dist). Walking the ancestors covers both, and only a
// directory containing index.html counts, so a missing build never half-serves the SPA.
const resolveDashboardDist = (): string | null => {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 4; up++) {
    for (const rel of ['dashboard-dist', path.join('dashboard', 'dist')]) {
      const candidate = path.resolve(dir, rel);
      if (existsSync(path.join(candidate, 'index.html'))) return candidate;
    }
    dir = path.resolve(dir, '..');
  }
  return null;
};

export const mountStatic = (app: Express): void => {
  const dist = resolveDashboardDist();
  if (!dist) {
    log.warn('dashboard build not found — SPA routes will return the JSON 404');
    app.use((_req, res, next) => next()); // no dashboard built — the JSON 404 answers
    return;
  }
  log.info({ dist }, 'serving dashboard');
  app.use(express.static(dist, { index: false }));
  // SPA fallback: a GET that static and the /api routers did not handle serves index.html.
  // Express 5 path syntax (pathToRegexp v8) has no bare '*', so this is plain middleware
  // mounted before the 404. /api/* and non-GETs fall through to the JSON 404.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
};
