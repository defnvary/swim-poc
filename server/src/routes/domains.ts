import { Router } from 'express';
import type { Model, ModelStatic } from 'sequelize';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/sequelize.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';
import { issueCert, verifyDns } from '../services/certs.js';
import { removeVhost, reload, renderVhost, writeVhostAndReload } from '../services/nginx.js';
import { event } from '../services/audit.js';

export const domainsGlobalRouter = Router(); // /api/domains/:id
export const domainsAppRouter = Router({ mergeParams: true }); // /api/apps/:id/domains

interface DomainInstance extends Model {
  id: string;
  appId: string;
  host: string;
  certStatus: 'pending' | 'issued' | 'failed';
  certIssuedAt: Date | null;
  createdAt: Date;
}
interface AppInstance extends Model {
  id: string;
  slug: string;
  port: number;
  healthcheckPath: string;
}
const Domains = db.Domain as unknown as ModelStatic<DomainInstance>;
const Apps = db.App as unknown as ModelStatic<AppInstance>;

const requireMember = requireRole('member', 'admin');

// 06 §8 hostname rule: anchored, ≤253 chars, must not equal the platform host
const hostSchema = z
  .string()
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);

const platformHost = () => `swim.${config.swimDomain ?? 'swim.local'}`;

// The default domain row is created together with the app: host === <slug>.<SWIM_DOMAIN> (06 §8)
const isDefaultDomain = async (d: DomainInstance): Promise<boolean> => {
  const app = await Apps.findByPk(d.appId);
  return !!app && d.host === `${app.slug}.${config.swimDomain ?? 'swim.local'}`;
};

const domainJson = (d: DomainInstance) => ({
  id: d.id,
  host: d.host,
  certStatus: d.certStatus,
  certIssuedAt: d.certIssuedAt?.toISOString() ?? null,
  createdAt: d.createdAt.toISOString(),
});

domainsAppRouter.use(requireAuth);
domainsGlobalRouter.use(requireAuth);

// GET /api/apps/:id/domains — any role
domainsAppRouter.get('/', async (req, res) => {
  const app = await Apps.findByPk(String((req.params as Record<string, string>).id));
  if (!app) throw new HttpError(404, 'not_found', 'app not found');
  const rows = await Domains.findAll({ where: { appId: app.id }, order: [['createdAt', 'ASC']] });
  res.json(rows.map(domainJson));
});

// POST — 201 immediately; vhost + cert issuance kick off in the background (09 §5)
domainsAppRouter.post('/', requireMember, async (req, res) => {
  const body = z.object({ host: hostSchema }).strict().parse(req.body);
  if (body.host === platformHost()) {
    throw new HttpError(422, 'validation_failed', 'host must not equal the platform host');
  }
  const app = await Apps.findByPk(String((req.params as Record<string, string>).id));
  if (!app) throw new HttpError(404, 'not_found', 'app not found');
  if (await Domains.findOne({ where: { host: body.host } })) {
    throw new HttpError(409, 'conflict', 'host already in use'); // host is unique across all apps (05 §1)
  }
  const domain = await Domains.create({ appId: app.id, host: body.host });
  await writeVhostAndReload(body.host, renderVhost(body.host, false));
  void issueCert(body.host, domain.id);
  await event('domain.added', { userId: req.user!.id, targetType: 'domain', targetId: domain.id }, { host: body.host });
  res.status(201).json({ id: domain.id, host: domain.host, certStatus: domain.certStatus });
});

domainsGlobalRouter.delete('/:id', requireMember, async (req, res) => {
  const domain = await Domains.findByPk(String((req.params as Record<string, string>).id));
  if (!domain) throw new HttpError(404, 'not_found', 'domain not found');
  if (await isDefaultDomain(domain)) {
    throw new HttpError(409, 'conflict', 'the default domain cannot be deleted while the app exists');
  }
  await removeVhost(domain.host);
  await reload();
  await domain.destroy();
  await event('domain.removed', { userId: req.user!.id, targetType: 'domain', targetId: domain.id }, { host: domain.host });
  res.status(204).end();
});

// POST verify — re-check DNS; retry a failed cert once when DNS is correct (09 §5, §9)
domainsGlobalRouter.post('/:id/verify', requireMember, async (req, res) => {
  const domain = await Domains.findByPk(String((req.params as Record<string, string>).id));
  if (!domain) throw new HttpError(404, 'not_found', 'domain not found');
  const dns = await verifyDns(domain.host);
  if (domain.certStatus === 'failed' && dns.resolved && dns.pointsToServer) {
    void issueCert(domain.host, domain.id);
  }
  res.json({ host: domain.host, certStatus: domain.certStatus, dns });
});
