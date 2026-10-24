import { access } from 'node:fs/promises';
import { resolve4 } from 'node:dns/promises';
import { pino } from 'pino';
import type { Model, ModelStatic } from 'sequelize';
import { db } from '../db/sequelize.js';
import { event } from './audit.js';
import { issueCertArgs, renewCertArgs, runCertbot, reloadNginx } from './docker.js';
import { renderPlatformVhost, renderVhostStage2, writeVhostAndReload, platformHost } from './nginx.js';

// issueCert + DNS verification + the daily renewal entry point (09 §5, §6, §8)

const log = pino({ level: 'info' });

interface DomainInstance extends Model {
  id: string;
  appId: string;
  host: string;
  certStatus: 'pending' | 'issued' | 'failed';
  certIssuedAt: Date | null;
}
const Domains = db.Domain as unknown as ModelStatic<DomainInstance>;

interface AppInstance extends Model {
  id: string;
  slug: string;
  port: number;
  healthcheckPath: string;
}
const Apps = db.App as unknown as ModelStatic<AppInstance>;

// Stub-able DNS seam (11 §4 "resolver stubbed"): tests replace dns.resolve4
export const dns = { resolve4 };

// 09 §5 verify: pointsToServer = the host's A records intersect the platform's (09 §5)
export const verifyDns = async (host: string): Promise<{ resolved: boolean; pointsToServer: boolean }> => {
  const [records, platformRecords] = await Promise.all([
    dns.resolve4(host).catch(() => [] as string[]),
    dns.resolve4(platformHost()).catch(() => [] as string[]),
  ]);
  const points = new Set(platformRecords);
  return { resolved: records.length > 0, pointsToServer: records.some((ip) => points.has(ip)) };
};

// 09 §5 issueCert(host, domainId?): certonly → on success rewrite stage-2 vhost + reload + issued;
// on failure certStatus=failed, stage-1 vhost stays. There is no automatic retry (09 §9) —
// only verify retries once, and only when DNS is correct.
// Without a Domain row (platform host, 09 §8) the success path rewrites the platform vhost.
export const issueCert = async (host: string, domainId?: string): Promise<boolean> => {
  try {
    const res = await runCertbot(issueCertArgs(host));
    if (res.code !== 0) throw new Error(`certbot exited ${res.code}: ${res.output.split('\n').slice(-5).join('\n')}`);
    if (domainId) {
      const app = await Apps.findByPk((await Domains.findByPk(domainId))!.appId);
      await writeVhostAndReload(host, renderVhostStage2(host, app!.slug, app!.port));
      await Domains.update({ certStatus: 'issued', certIssuedAt: new Date() }, { where: { id: domainId } });
      await event('domain.cert_issued', { targetType: 'domain', targetId: domainId }, { host });
    } else {
      await writeVhostAndReload(host, renderPlatformVhost(host));
    }
    return true;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (domainId) {
      await Domains.update({ certStatus: 'failed' }, { where: { id: domainId } });
      await event('domain.cert_failed', { targetType: 'domain', targetId: domainId }, { host, error });
    } else {
      log.error({ host, error }, 'platform cert issuance failed');
    }
    return false;
  }
};

// 09 §8 daily timer (wired at boot in phase 6): renew → reload; every error logged,
// the timer never dies. Pruning steps (05 §6) are phase 6 work.
export const renewAll = async (): Promise<void> => {
  try {
    const res = await runCertbot(renewCertArgs());
    if (res.code !== 0) throw new Error(`certbot renew exited ${res.code}`);
    await reloadNginx(['nginx', '-s', 'reload']);
  } catch (err) {
    log.error({ err }, 'cert renewal failed');
  }
};

// Cert path helper (04 §2): the api mounts the swim-certs volume; exact host path is
// confirmed in phase 6 when docker-compose.yml is written (08 §2).
export const certDir = (host: string): string => `/data/certs/live/${host}`;
export const certExists = async (host: string): Promise<boolean> =>
  access(`${certDir(host)}/fullchain.pem`).then(() => true).catch(() => false);
