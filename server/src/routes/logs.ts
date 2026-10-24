import { Router } from 'express';
import type { Model, ModelStatic } from 'sequelize';
import { z } from 'zod';
import { db } from '../db/sequelize.js';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';
import { appHealth, appLogs } from '../services/docker.js';
import { openSSE } from '../lib/sse.js';

export const logsRouter = Router({ mergeParams: true }); // /api/apps/:id/logs

interface LogAppInstance extends Model {
  id: string;
  slug: string;
}
const Apps = db.App as unknown as ModelStatic<LogAppInstance>;

logsRouter.use(requireAuth);

// 06 §7 — "stream logs" is every-role (06 §2), so requireAuth without a role gate.
// docker CLI + /data stays in services/* (04 §5): this route only wires SSE to appLogs.
const querySchema = z
  .object({
    tail: z.coerce.number().int().min(1).max(10_000).default(200),
    since: z.string().datetime({ offset: true }).optional(),
    follow: z.coerce.boolean().default(false),
  })
  .strict();

logsRouter.get('/', async (req, res) => {
  const { tail, since, follow } = querySchema.parse(req.query);
  const app = await Apps.findByPk(String((req.params as Record<string, string>).id));
  if (!app) throw new HttpError(404, 'not_found', 'app not found');

  // 06 §7: no container → 409. appHealth reports "missing" when inspect fails.
  const health = await appHealth(app.slug);
  if (health === 'missing') throw new HttpError(409, 'conflict', 'app is not running');

  res.setTimeout(0); // long-lived stream (SSE endpoints must not hit the server timeout)
  const ac = new AbortController();
  const sse = openSSE(req, res, { kill: () => ac.abort() }); // disconnect kills `docker logs -f`, never orphans (06 §13)

  void appLogs(app.slug, {
    tail,
    since,
    follow,
    signal: ac.signal,
    onLine: (line) => sse.send('log', { line }),
  })
    .then(() => sse.send('done', { status: 'eof' }))
    .catch((err: unknown) => sse.send('log', { line: `log stream error: ${err instanceof Error ? err.message : String(err)}` }));
});
