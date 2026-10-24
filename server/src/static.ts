import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';

// 04 §2 — serve the built dashboard; unknown GETs (non-/api) fall back to index.html.
// Mount after the /api routers and before the JSON 404 (04 §2 middleware order).

// The image ships the dashboard at /app/dashboard-dist (08 §3): from server/dist/static.js
// that is `../dashboard-dist`. In the source tree the same hop lands in server/, so the
// dev layout resolves to <repo>/dashboard/dist.
const resolveDashboardDist = (): string | null => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '..', 'dashboard-dist'),
    path.resolve(here, '..', '..', 'dashboard', 'dist'),
  ];
  return (
    candidates.find((dir) => existsSync(path.join(dir, 'index.html'))) ?? null
  );
};

export const mountStatic = (app: Express): void => {
  const dist = resolveDashboardDist();
  if (!dist) {
    app.use((_req, res, next) => next()); // no dashboard built — the JSON 404 answers
    return;
  }
  app.use(express.static(dist, { index: false }));
  // SPA fallback: a GET that static and the /api routers did not handle serves index.html.
  // Express 5 path syntax (pathToRegexp v8) has no bare '*', so this is plain middleware
  // mounted before the 404. /api/* and non-GETs fall through to the JSON 404.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
};
