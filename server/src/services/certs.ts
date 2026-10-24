import { access, rm, stat } from "node:fs/promises";
import { resolve4 } from "node:dns/promises";
import { join } from "node:path";
import { pino } from "pino";
import { Op } from "sequelize";
import type { Model, ModelStatic } from "sequelize";
import { db } from "../db/sequelize.js";
import { event } from "./audit.js";
import {
  deploymentLogFile,
  issueCertArgs,
  listAppImages,
  removeImage,
  renewCertArgs,
  runCertbot,
  reloadNginx,
} from "./docker.js";
import {
  renderPlatformVhost,
  renderVhostStage1,
  renderVhostStage2,
  writeVhostAndReload,
  platformHost,
} from "./nginx.js";

// issueCert + DNS verification + the daily renewal entry point (09 §5, §6, §8)

const log = pino({ level: "info" });

interface DomainInstance extends Model {
  id: string;
  appId: string;
  host: string;
  certStatus: "pending" | "issued" | "failed";
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

interface DeploymentLite extends Model {
  id: string;
  appId: string;
}
const Deployments = db.Deployment as unknown as ModelStatic<DeploymentLite>;

interface SimpleModel extends Model {}
const Events = db.Event as unknown as ModelStatic<SimpleModel>;
const RefreshTokens = db.RefreshToken as unknown as ModelStatic<SimpleModel>;

// Stub-able DNS seam (11 §4 "resolver stubbed"): tests replace dns.resolve4
export const dns = { resolve4 };

// 09 §5 verify: pointsToServer = the host's A records intersect the platform's (09 §5)
export const verifyDns = async (
  host: string,
): Promise<{ resolved: boolean; pointsToServer: boolean }> => {
  const [records, platformRecords] = await Promise.all([
    dns.resolve4(host).catch(() => [] as string[]),
    dns.resolve4(platformHost()).catch(() => [] as string[]),
  ]);
  const points = new Set(platformRecords);
  return {
    resolved: records.length > 0,
    pointsToServer: records.some((ip) => points.has(ip)),
  };
};

// 09 §5 issueCert(host, domainId?): certonly → on success rewrite stage-2 vhost + reload + issued;
// on failure certStatus=failed, stage-1 vhost stays. There is no automatic retry (09 §9) —
// only verify retries once, and only when DNS is correct.
// Without a Domain row (platform host, 09 §8) the success path rewrites the platform vhost.
export const issueCert = async (
  host: string,
  domainId?: string,
): Promise<boolean> => {
  try {
    const res = await runCertbot(issueCertArgs(host));
    if (res.code !== 0)
      throw new Error(
        `certbot exited ${res.code}: ${res.output.split("\n").slice(-5).join("\n")}`,
      );
    if (domainId) {
      const app = await Apps.findByPk(
        (await Domains.findByPk(domainId))!.appId,
      );
      await writeVhostAndReload(
        host,
        renderVhostStage2(host, app!.slug, app!.port),
      );
      await Domains.update(
        { certStatus: "issued", certIssuedAt: new Date() },
        { where: { id: domainId } },
      );
      await event(
        "domain.cert_issued",
        { targetType: "domain", targetId: domainId },
        { host },
      );
    } else {
      await writeVhostAndReload(host, renderPlatformVhost(host));
    }
    return true;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (domainId) {
      await Domains.update(
        { certStatus: "failed" },
        { where: { id: domainId } },
      );
      await event(
        "domain.cert_failed",
        { targetType: "domain", targetId: domainId },
        { host, error },
      );
    } else {
      log.error({ host, error }, "platform cert issuance failed");
    }
    return false;
  }
};

// 09 §8 step 1, run by the daily timer (once at boot, then every 24 h).
export const renewAll = async (): Promise<void> => {
  try {
    const res = await runCertbot(renewCertArgs());
    if (res.code !== 0) throw new Error(`certbot renew exited ${res.code}`);
    await reloadNginx(["nginx", "-s", "reload"]);
  } catch (err) {
    log.error({ err }, "cert renewal failed");
  }
};

// 09 §8 step 4 + 09 §7: if the platform cert is missing, write the stage-1 vhost,
// issue, and let issueCert's success path write the stage-2 vhost + reload.
// certbot renew never creates a certificate (09 §9) — a missing cert means bootstrap.
// Returns whether the certificate is present afterwards (for the boot log line).
export const reconcilePlatformCert = async (): Promise<boolean> => {
  const host = platformHost();
  if (await certExists(host)) {
    await writeVhostAndReload(host, renderPlatformVhost(host));
    return true;
  }
  await writeVhostAndReload(host, renderVhostStage1(host));
  const ok = await issueCert(host);
  log.info({ host, issued: ok }, "platform certificate bootstrap");
  return ok;
};

// ---- 09 §8 step 2 = 08 §6 + 05 §6. The api container sees the swim-data volume at
// config.dataDir and swim-certs at /etc/letsencrypt (08 §2).

const KEEP_IMAGES = 5; // 08 §6
const KEEP_DEPLOYMENT_LOGS = 50; // 05 §6
const EVENT_RETENTION_DAYS = 180; // 05 §6
const REFRESH_TOKEN_GRACE_DAYS = 30; // 05 §3 step 5

// `docker images` prints newest-first; keep 5 tags, rmi the rest, in-use errors ignored.
const pruneImages = async (): Promise<void> => {
  const apps = await Apps.findAll({ attributes: ["slug"] });
  for (const app of apps) {
    const tags = await listAppImages(app.slug);
    for (const tag of tags.slice(KEEP_IMAGES)) await removeImage(tag);
  }
};

const pruneDeploymentLogs = async (): Promise<void> => {
  const apps = await Apps.findAll({
    include: [{ model: Deployments, attributes: ["id"] }],
  });
  for (const app of apps) {
    const ids = (
      app as unknown as { Deployments: DeploymentLite[] }
    ).Deployments.map((d) => d.id);
    const mtimes = await Promise.all(
      ids.map(async (id) => {
        const file = deploymentLogFile(id);
        const mtimeMs = await stat(file).then(
          (s) => s.mtimeMs,
          () => -1,
        );
        return { file, mtimeMs };
      }),
    );
    const stale = mtimes
      .filter((e) => e.mtimeMs >= 0)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(KEEP_DEPLOYMENT_LOGS);
    for (const e of stale)
      await rm(e.file, { force: true }).catch(() => undefined); // rows keep their metadata (05 §6)
  }
};

const pruneDb = async (): Promise<void> => {
  const now = Date.now();
  await Events.destroy({
    where: {
      createdAt: { [Op.lt]: new Date(now - EVENT_RETENTION_DAYS * 86_400_000) },
    },
  });
  await RefreshTokens.destroy({
    where: {
      expiresAt: {
        [Op.lt]: new Date(now - REFRESH_TOKEN_GRACE_DAYS * 86_400_000),
      },
    },
  });
};

export const pruneAll = async (): Promise<void> => {
  // each step fails alone (09 §8: every error logged)
  const steps: [string, () => Promise<void>][] = [
    ["image pruning", pruneImages],
    ["deployment-log pruning", pruneDeploymentLogs],
    ["event/refresh-token pruning", pruneDb],
  ];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (err) {
      log.error({ err }, `${name} failed`);
    }
  }
};

// 09 §8: every 24 h and once at boot; the timer never dies — each tick catches its own
// errors and always reschedules. `renewNow` false skips the renewal in the immediate tick
// only (boot reconciliation step 4 already handles the cert; a second full certbot run
// back-to-back would just stall startup). unref(): an idle process can still exit (11 §4).
const DAY_MS = 86_400_000;
export const startDailyTimer = ({
  renewNow = true,
}: { renewNow?: boolean } = {}): NodeJS.Timeout => {
  const tick = (renew: boolean): void => {
    if (renew)
      void renewAll().catch((err) => log.error({ err }, "renewal tick failed"));
    void pruneAll().catch((err) => log.error({ err }, "pruning tick failed"));
    timer.refresh();
  };
  const timer = setInterval(() => tick(true), DAY_MS);
  timer.unref();
  tick(renewNow);
  return timer;
};

// Cert path helper (04 §2): the api mounts swim-certs at /etc/letsencrypt (08 §2),
// so inside the container certbot's tree lives there — confirmed in phase 6.
export const certDir = (host: string): string =>
  join("/etc/letsencrypt", "live", host);
export const certExists = async (host: string): Promise<boolean> =>
  access(`${certDir(host)}/fullchain.pem`)
    .then(() => true)
    .catch(() => false);
