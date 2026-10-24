import { pino } from "pino";
import type { Model, ModelStatic } from "sequelize";
import { config } from "../config.js";
import { db } from "../db/sequelize.js";
import { event } from "./audit.js";
import {
  appHealth,
  compose,
  removeAppData,
  upDetachedNoBuild,
} from "./docker.js";
import { removeVhosts } from "./nginx.js";

// 07 §2 — per-app serial FIFO + global build semaphore. The pipeline body itself is
// services/deploy.ts, injected at boot by index.ts via setDeployRunner (tests leave it
// unwired, so queued rows stay queued — the 11 §4 observation seam).

const log = pino({ level: "info" });

export type DeployRunner = (
  appId: string,
  deploymentId: string,
) => Promise<void>;

let runner: DeployRunner | null = null;

export const setDeployRunner = (r: DeployRunner): void => {
  runner = r;
};

// Observation seam (11 §4): set to a spy in integration tests; production never sets it.
let observer: ((appId: string, deploymentId: string) => void) | null = null;
export const setDeployObserver = (
  fn: ((appId: string, deploymentId: string) => void) | null,
): void => {
  observer = fn;
};

interface DeploymentLite extends Model {
  id: string;
  appId: string;
  status: string;
  error: string | null;
  finishedAt: Date | null;
}
const Deployments = db.Deployment as unknown as ModelStatic<DeploymentLite>;

interface AppLite extends Model {
  slug: string;
}
const Apps = db.App as unknown as ModelStatic<AppLite>;

// ---- per-app serial FIFO: arrival order = execution order, a rejected task
// never poisons the chain, and a settled chain entry is dropped (no leak).
const chains = new Map<string, Promise<void>>();

export const enqueue = (
  appId: string,
  task: () => Promise<void>,
): Promise<void> => {
  const prev = chains.get(appId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  const tracked = next.catch(() => undefined);
  chains.set(appId, tracked);
  void tracked.finally(() => {
    if (chains.get(appId) === tracked) chains.delete(appId);
  });
  return next;
};

// ---- global build semaphore: acquired before `compose build`, released right after
// `up -d` — health polling never holds a slot (07 §2, §5).
export type BuildRelease = () => void;

let active = 0;
const buildWaiters: (() => void)[] = [];

const makeRelease = (): BuildRelease => {
  let done = false;
  return () => {
    if (done) return; // idempotent — a double release must not corrupt the counter
    done = true;
    active--;
    buildWaiters.shift()?.();
  };
};

export const acquireBuildSlot = (): Promise<BuildRelease> => {
  if (active < config.maxBuilds) {
    active++;
    return Promise.resolve(makeRelease());
  }
  return new Promise((resolve) => {
    buildWaiters.push(() => {
      active++;
      resolve(makeRelease());
    });
  });
};

// The queued row is inserted by the route/hook before enqueueing (07 §2); the 202 has
// already returned when this runs.
export const queueDeployment = (
  appId: string,
  deploymentId: string,
): Promise<void> => {
  observer?.(appId, deploymentId);
  return enqueue(appId, async () => {
    if (!runner) {
      log.info(
        { appId, deploymentId },
        "deploy pipeline not wired (tests only) — row stays queued",
      );
      return;
    }
    await runner(appId, deploymentId);
  });
};

// 07 §2: an api restart kills in-flight child processes; a non-terminal, non-queued row
// can only be stale. Queued rows are re-enqueued (their pipeline never started).
export const recoverOnBoot = async (): Promise<void> => {
  const [stuck, queued] = await Promise.all([
    Deployments.findAll({
      where: { status: ["fetching", "building", "deploying"] },
    }),
    Deployments.findAll({
      where: { status: "queued" },
      order: [["createdAt", "ASC"]],
    }),
  ]);
  for (const d of stuck) {
    await d.update({
      status: "failed",
      error: "api restarted during deployment",
      finishedAt: new Date(),
    });
    await event(
      "deploy.failed",
      { targetType: "deployment", targetId: d.id },
      { error: d.error ?? undefined },
    );
  }
  for (const d of queued) void queueDeployment(d.appId, d.id);
};

// 07 §10 step 5: a live app whose container is gone (host reboot, external kill) gets
// `up -d --no-build`. Idempotent — a running container makes it a no-op; failures only log.
export const reconcileApps = async (): Promise<void> => {
  const apps = await Apps.findAll({ where: { status: "live" } });
  for (const app of apps) {
    if ((await appHealth(app.slug)) === "missing") {
      log.info(
        { slug: app.slug },
        "live app has no container — up -d --no-build",
      );
      const res = await upDetachedNoBuild(app.slug);
      if (res.code !== 0)
        log.error({ slug: app.slug, code: res.code }, "app restart failed");
    }
  }
};

// 05 §4 teardown, in order: compose down --rmi local, vhosts + reload, /data + logs.
// Idempotent: every step tolerates resources that are already gone.
export const teardownApp = async (app: {
  id: string;
  slug: string;
  hosts: string[];
  deploymentIds: string[];
}): Promise<void> => {
  await compose(app.slug, ["down"], { rmi: true });
  await removeVhosts(app.hosts);
  await removeAppData(app.slug, app.deploymentIds);
};
