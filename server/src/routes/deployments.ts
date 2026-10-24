import { Router } from 'express';
import { Op, type Model, type ModelStatic } from 'sequelize';
import { z } from 'zod';
import { db } from '../db/sequelize.js';
import { openSSE } from '../lib/sse.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';
import { subscribeDeploymentLog, tailDeploymentLog } from '../services/deploy.js';
import { queueDeployment } from '../services/deploy-queue.js';
import { event } from '../services/audit.js';

export const deploymentsRouter = Router({ mergeParams: true }); // /api/apps/:id/deployments
export const deploymentsGlobalRouter = Router(); // /api/deployments/:id

interface DeploymentInstance extends Model {
  id: string;
  appId: string;
  commitSha: string;
  commitMessage: string | null;
  author: string | null;
  branch: string;
  status: 'queued' | 'fetching' | 'building' | 'deploying' | 'live' | 'failed';
  trigger: 'webhook' | 'manual';
  userId: string | null;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}
interface UserInstance extends Model {
  id: string;
  username: string;
}
export interface AppLite extends Model {
  id: string;
  branch: string;
}
const Deployments = db.Deployment as unknown as ModelStatic<DeploymentInstance>;
const Apps = db.App as unknown as ModelStatic<AppLite>;

const TERMINAL: DeploymentInstance['status'][] = ['live', 'failed'];
const requireMember = requireRole('member', 'admin');

const paginationSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

// 06 §6 — 40-hex SHA; default target is branch HEAD, which the pipeline resolves at
// fetch time (07 §3, 10 §6); the row carries the all-zero marker until then.
const HEAD_SHA = '0'.repeat(40);

const deploymentJson = (d: DeploymentInstance, username: string | null) => ({
  id: d.id,
  appId: d.appId,
  commitSha: d.commitSha,
  commitMessage: d.commitMessage,
  author: d.author,
  branch: d.branch,
  status: d.status,
  trigger: d.trigger,
  triggeredBy: username,
  error: d.error,
  startedAt: d.startedAt?.toISOString() ?? null,
  finishedAt: d.finishedAt?.toISOString() ?? null,
  createdAt: d.createdAt.toISOString(),
});

const withUser = async (rows: DeploymentInstance[]): Promise<unknown[]> => {
  const userIds = [...new Set(rows.map((d) => d.userId).filter((u): u is string => u !== null))];
  const users = userIds.length
    ? await (db.User as ModelStatic<UserInstance>).findAll({ where: { id: userIds }, attributes: ['id', 'username'] })
    : [];
  const byId = new Map(users.map((u) => [u.id as string, u.username]));
  return rows.map((d) => deploymentJson(d, d.userId ? byId.get(d.userId) ?? null : null));
};

// Manual deploy (also env applyNow, 06 §9): insert queued row + event, return 202;
// pipeline execution is the phase-4 queue. 409 while a non-terminal deployment exists (07 §2).
export const createManualDeployment = async (app: AppLite, userId: string, commitSha: string | null) => {
  if (await Deployments.count({ where: { appId: app.id, status: { [Op.notIn]: TERMINAL } } })) {
    throw new HttpError(409, 'conflict', 'a deployment is already running for this app');
  }
  const deployment = await Deployments.create({
    appId: app.id,
    commitSha: commitSha ?? HEAD_SHA,
    branch: app.branch,
    status: 'queued',
    trigger: 'manual',
    userId,
  });
  await event('deploy.queued', { userId, targetType: 'deployment', targetId: deployment.id }, {
    trigger: 'manual',
    sha: deployment.commitSha,
  });
  void queueDeployment(app.id, deployment.id);
  return deployment;
};

deploymentsRouter.use(requireAuth);
deploymentsGlobalRouter.use(requireAuth);

deploymentsRouter.get('/', async (req, res) => {
  const { page, limit } = paginationSchema.parse(req.query);
  const { rows, count } = await Deployments.findAndCountAll({
    where: { appId: String((req.params as Record<string, string>).id) },
    order: [['createdAt', 'DESC']],
    offset: (page - 1) * limit,
    limit,
  });
  res.json({ data: await withUser(rows), meta: { page, limit, total: count } });
});

deploymentsRouter.post('/', requireMember, async (req, res) => {
  const body = z
    .object({ commitSha: z.string().regex(/^[0-9a-f]{40}$/).optional() })
    .strict()
    .parse(req.body ?? {});
  const app = await Apps.findByPk(String((req.params as Record<string, string>).id));
  if (!app) throw new HttpError(404, 'not_found', 'app not found');
  const deployment = await createManualDeployment(app, req.user!.id, body.commitSha ?? null);
  res.status(202).json({ deployment: deploymentJson(deployment, req.user!.username) });
});

deploymentsGlobalRouter.get('/:id', async (req, res) => {
  const deployment = await Deployments.findByPk(String((req.params as Record<string, string>).id));
  if (!deployment) throw new HttpError(404, 'not_found', 'deployment not found');
  const [json] = await withUser([deployment]);
  res.json(json);
});

// 06 §6 + §13 — GET /api/deployments/:id/logs?tail&follow=1: tail the 07 §8 file,
// then (while the deployment is active) stream live log/status events, `done` closes.
const ACTIVE: DeploymentInstance['status'][] = ['queued', 'fetching', 'building', 'deploying'];

const logsQuerySchema = z
  .object({
    tail: z.coerce.number().int().min(1).max(10_000).default(200),
    follow: z.coerce.boolean().default(false),
  })
  .strict();

deploymentsGlobalRouter.get('/:id/logs', async (req, res) => {
  const { tail, follow } = logsQuerySchema.parse(req.query);
  const id = String((req.params as Record<string, string>).id);
  const deployment = await Deployments.findByPk(id);
  if (!deployment) throw new HttpError(404, 'not_found', 'deployment not found');

  res.setTimeout(0);
  let unsubscribe = (): void => {};
  let closed = false;
  const sse = openSSE(req, res, {
    kill: () => {
      closed = true;
      unsubscribe();
    },
  });
  const send = (event: string, data: unknown): void => {
    if (!closed) sse.send(event, data);
  };
  const end = (): void => {
    unsubscribe();
    res.end();
  };

  const activeNow = ACTIVE.includes(deployment.status);
  if (follow && activeNow) {
    unsubscribe = subscribeDeploymentLog(id, (e) => {
      if (e.type === 'log') send('log', { line: e.line });
      else if (e.type === 'status') send('status', { status: e.status });
      else {
        send('done', { status: e.status });
        end();
      }
    });
  }

  const lines = await tailDeploymentLog(id, tail);
  for (const line of lines) send('log', { line });

  // settled between the row read and the tail, or follow not requested → close now;
  // subscribing first means late lines duplicate rather than drop (06 §13)
  const fresh = follow && activeNow ? await Deployments.findByPk(id) : null;
  if (!fresh || !ACTIVE.includes(fresh.status)) {
    send('done', { status: fresh?.status ?? deployment.status });
    end();
  }
});
