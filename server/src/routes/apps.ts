import { randomBytes, randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import type { Model, ModelStatic } from 'sequelize';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/sequelize.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';
import { issueCert } from '../services/certs.js';
import { compose, writeCompose } from '../services/docker.js';
import { teardownApp } from '../services/deploy-queue.js';
import { renderVhostStage1, writeVhostAndReload } from '../services/nginx.js';
import { event } from '../services/audit.js';

export const appsRouter = Router();

interface AppInstance extends Model {
  id: string;
  name: string;
  slug: string;
  repoOwner: string;
  repoName: string;
  branch: string;
  port: number;
  healthcheckPath: string;
  buildType: 'auto' | 'dockerfile' | 'node' | 'static';
  autoDeploy: boolean;
  accessTokenEnc: string | null;
  webhookSecretEnc: string;
  hookId: string;
  status: 'created' | 'building' | 'live' | 'failed' | 'stopped';
  currentDeploymentId: string | null;
  createdById: string;
  createdAt: Date;
}
interface DomainInstance extends Model {
  id: string;
  appId: string;
  host: string;
  certStatus: 'pending' | 'issued' | 'failed';
  certIssuedAt: Date | null;
  createdAt: Date;
}
interface DeploymentInstance extends Model {
  id: string;
  commitSha: string;
  commitMessage: string | null;
  author: string | null;
  status: string;
  createdAt: Date;
}
const Apps = db.App as unknown as ModelStatic<AppInstance>;
const Domains = db.Domain as unknown as ModelStatic<DomainInstance>;
const Deployments = db.Deployment as unknown as ModelStatic<DeploymentInstance>;

declare module 'express-serve-static-core' {
  interface Request {
    swimApp?: AppInstance;
  }
}

appsRouter.use(requireAuth);

const requireMember = requireRole('member', 'admin');

const defaultHost = (slug: string): string => `${slug}.${config.swimDomain ?? 'swim.local'}`;
const webhookUrl = (hookId: string): string => `https://swim.${config.swimDomain ?? 'swim.local'}/api/hooks/${hookId}`;
const newHook = () => ({ hookId: randomUUID(), secret: randomBytes(20).toString('hex') }); // hex40 (06 §5)

// 05 §2: [a-z0-9-]{3,30}, derived from the name; uniquified with -2, -3, …
export const deriveSlug = (name: string): string => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  return base.length >= 3 ? base : `app-${base}`.slice(0, 28).replace(/-+$/g, '') || 'app';
};

export const uniquify = (base: string, taken: ReadonlySet<string>): string => {
  let slug = base;
  for (let n = 2; taken.has(slug); n++) {
    slug = `${base.slice(0, 30 - String(n).length - 1)}-${n}`;
  }
  return slug;
};

const uniqueSlug = async (name: string): Promise<string> => {
  const rows = await Apps.findAll({ attributes: ['slug'] });
  return uniquify(deriveSlug(name), new Set(rows.map((r) => r.slug)));
};

const baseShape = {
  name: z.string().min(1).max(50),
  repoOwner: z.string().regex(/^[A-Za-z0-9-]+$/),
  repoName: z.string().regex(/^[A-Za-z0-9._-]+$/),
  branch: z.string().regex(/^[A-Za-z0-9._/-]+$/),
  port: z.number().int().min(1).max(65535),
  healthcheckPath: z.string().regex(/^\//),
  buildType: z.enum(['auto', 'dockerfile', 'node', 'static']),
  autoDeploy: z.boolean(),
  accessToken: z.string().min(1),
};

// 06 §5 POST body: defaults for the optional fields, accessToken optional (required only for private repos)
const createSchema = z
  .object({
    ...baseShape,
    branch: baseShape.branch.default('main'),
    port: baseShape.port.default(3000),
    healthcheckPath: baseShape.healthcheckPath.default('/'),
    buildType: baseShape.buildType.default('auto'),
    autoDeploy: baseShape.autoDeploy.default(true),
    accessToken: baseShape.accessToken.optional(),
  })
  .strict();

// PATCH: every field optional (regexes still enforced), at least one required
const patchSchema = z
  .object({
    name: baseShape.name.optional(),
    repoOwner: baseShape.repoOwner.optional(),
    repoName: baseShape.repoName.optional(),
    branch: baseShape.branch.optional(),
    port: baseShape.port.optional(),
    healthcheckPath: baseShape.healthcheckPath.optional(),
    buildType: baseShape.buildType.optional(),
    autoDeploy: baseShape.autoDeploy.optional(),
    accessToken: baseShape.accessToken.optional(),
  })
  .strict()
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'at least one field required' });

const loadApp: (req: Request, _res: unknown, next: () => void) => Promise<void> = async (req, _res, next) => {
  const app = await Apps.findByPk(String((req.params as Record<string, string>).id));
  if (!app) throw new HttpError(404, 'not_found', 'app not found');
  req.swimApp = app;
  next();
};

const appDomains = (appId: string) => Domains.findAll({ where: { appId }, order: [['createdAt', 'ASC']] });

const deploymentSummary = (d: DeploymentInstance) => ({
  id: d.id,
  commitSha: d.commitSha,
  commitMessage: d.commitMessage,
  author: d.author,
  status: d.status,
  createdAt: d.createdAt.toISOString(),
});

// 06 §5 — never includes webhookSecret / PAT material
const appJson = async (a: AppInstance, full: boolean) => {
  const domains = (await appDomains(a.id)).map((d) => ({
    id: d.id,
    host: d.host,
    certStatus: d.certStatus,
    certIssuedAt: d.certIssuedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  }));
  const current = full && a.currentDeploymentId ? await Deployments.findByPk(a.currentDeploymentId) : null;
  return {
    id: a.id,
    name: a.name,
    slug: a.slug,
    repoOwner: a.repoOwner,
    repoName: a.repoName,
    branch: a.branch,
    port: a.port,
    healthcheckPath: a.healthcheckPath,
    buildType: a.buildType,
    autoDeploy: a.autoDeploy,
    status: a.status,
    hasToken: a.accessTokenEnc !== null,
    tokenLast4: a.accessTokenEnc === null ? null : decrypt(a.accessTokenEnc).slice(-4),
    currentDeploymentId: a.currentDeploymentId,
    ...(full ? { domains, currentDeployment: current ? deploymentSummary(current) : null } : {}),
    createdAt: a.createdAt.toISOString(),
  };
};

appsRouter.get('/', async (req, res) => {
  const { page, limit } = z
    .object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) })
    .strict()
    .parse(req.query);
  const { rows, count } = await Apps.findAndCountAll({
    order: [['createdAt', 'DESC']],
    offset: (page - 1) * limit,
    limit,
  });
  res.json({ data: await Promise.all(rows.map((a) => appJson(a, false))), meta: { page, limit, total: count } });
});

// POST — the ONLY response that carries the webhook secret (06 §5)
appsRouter.post('/', requireMember, async (req, res) => {
  const body = createSchema.parse(req.body);
  const slug = await uniqueSlug(body.name);
  const hook = newHook();
  const app = await Apps.create({
    name: body.name,
    slug,
    repoOwner: body.repoOwner,
    repoName: body.repoName,
    branch: body.branch,
    port: body.port,
    healthcheckPath: body.healthcheckPath,
    buildType: body.buildType,
    autoDeploy: body.autoDeploy,
    accessTokenEnc: body.accessToken ? encrypt(body.accessToken) : null,
    webhookSecretEnc: encrypt(hook.secret),
    hookId: hook.hookId,
    createdById: req.user!.id,
  });
  const host = defaultHost(slug);
  const domain = await Domains.create({ appId: app.id, host });
  await writeVhostAndReload(host, renderVhostStage1(host));
  void issueCert(host, domain.id); // fire-and-forget (09 §5)
  await event('app.created', { userId: req.user!.id, targetType: 'app', targetId: app.id }, { slug });
  res.status(201).json({
    ...(await appJson(app, true)),
    webhook: { url: webhookUrl(hook.hookId), secret: hook.secret },
  });
});

appsRouter.get('/:id', loadApp, async (req, res) => {
  res.json(await appJson(req.swimApp!, true));
});

appsRouter.patch('/:id', requireMember, loadApp, async (req, res) => {
  const body = patchSchema.parse(req.body);
  const patch: Record<string, unknown> = {};
  for (const key of ['name', 'repoOwner', 'repoName', 'branch', 'port', 'healthcheckPath', 'buildType', 'autoDeploy'] as const) {
    const value = body[key];
    if (value !== undefined) patch[key] = value;
  }
  if (body.accessToken !== undefined) patch.accessTokenEnc = encrypt(body.accessToken); // replaces the stored PAT
  await req.swimApp!.update(patch);
  await event('app.updated', { userId: req.user!.id, targetType: 'app', targetId: req.swimApp!.id }, { fields: Object.keys(patch) });
  res.json(await appJson(req.swimApp!, true));
});

// 05 §4 — teardown (compose down --rmi local, vhosts, /data) happens before the DB delete
appsRouter.delete('/:id', requireMember, loadApp, async (req, res) => {
  const app = req.swimApp!;
  const domains = await appDomains(app.id);
  const deployments = await Deployments.findAll({ where: { appId: app.id }, attributes: ['id'] });
  await teardownApp({
    id: app.id,
    slug: app.slug,
    hosts: domains.map((d) => d.host),
    deploymentIds: deployments.map((d) => d.id),
  });
  await app.destroy(); // FK cascades do the rest (05 §4)
  await event('app.deleted', { userId: req.user!.id, targetType: 'app', targetId: app.id }, { slug: app.slug });
  res.status(204).end();
});

appsRouter.post('/:id/rotate-hook', requireMember, loadApp, async (req, res) => {
  const hook = newHook(); // new hookId + secret together — old URL stops working (05 §2)
  await req.swimApp!.update({ hookId: hook.hookId, webhookSecretEnc: encrypt(hook.secret) });
  await event('hook.rotated', { userId: req.user!.id, targetType: 'app', targetId: req.swimApp!.id }, { slug: req.swimApp!.slug });
  res.json({ webhook: { url: webhookUrl(hook.hookId), secret: hook.secret } });
});

// 06 §5 — stop: compose down, vhosts stay (nginx 502s); start: re-up from the current deployment's image
appsRouter.post('/:id/stop', requireMember, loadApp, async (req, res) => {
  await compose(req.swimApp!.slug, ['down']);
  await req.swimApp!.update({ status: 'stopped' });
  await event('app.stopped', { userId: req.user!.id, targetType: 'app', targetId: req.swimApp!.id }, { slug: req.swimApp!.slug });
  res.json({ status: 'stopped' });
});

appsRouter.post('/:id/start', requireMember, loadApp, async (req, res) => {
  const app = req.swimApp!;
  if (!app.currentDeploymentId) throw new HttpError(409, 'conflict', 'app has never been deployed');
  const deployment = await Deployments.findByPk(app.currentDeploymentId);
  if (!deployment) throw new HttpError(409, 'conflict', 'app has never been deployed');
  await writeCompose({
    slug: app.slug,
    sha8: deployment.commitSha.slice(0, 8),
    port: app.port,
    healthcheckPath: app.healthcheckPath,
    buildType: app.buildType,
  });
  await compose(app.slug, ['up', '-d'], { noBuild: true });
  await app.update({ status: 'live' });
  await event('app.started', { userId: req.user!.id, targetType: 'app', targetId: app.id }, { slug: app.slug });
  res.json({ status: 'live' });
});
