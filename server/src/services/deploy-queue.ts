import { pino } from 'pino';
import { compose, removeAppData } from './docker.js';
import { removeVhosts } from './nginx.js';

// Per-app serial FIFO + global build semaphore (07 §2).
// PHASE-3 SEAM: routes insert the queued Deployment row and hand the pipeline body
// here; execution becomes real when services/deploy.ts exists (phase 4).

const log = pino({ level: 'info' });

export type DeployRunner = (appId: string, deploymentId: string) => Promise<void>;

let runner: DeployRunner | null = null;

// phase 4 wires this to runDeployment from services/deploy.ts
export const setDeployRunner = (r: DeployRunner): void => {
  runner = r;
};

// Phase-3 observation seam (11 §4 "applyNow triggers a deploy, queue mocked to observe"):
// set to a spy in integration tests; production never sets it.
let observer: ((appId: string, deploymentId: string) => void) | null = null;
export const setDeployObserver = (fn: ((appId: string, deploymentId: string) => void) | null): void => {
  observer = fn;
};

const chains = new Map<string, Promise<void>>();

// Arrival order per app = execution order; different apps run concurrently;
// a rejected task never poisons the chain.
export const enqueue = (appId: string, task: () => Promise<void>): Promise<void> => {
  const prev = chains.get(appId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  const tracked = next.catch(() => undefined);
  chains.set(appId, tracked);
  void tracked.finally(() => {
    if (chains.get(appId) === tracked) chains.delete(appId);
  });
  return next;
};

// Manual deploys pass the phase-2 row; the pipeline runs serialized per app.
export const queueDeployment = (appId: string, deploymentId: string): Promise<void> => {
  observer?.(appId, deploymentId);
  return enqueue(appId, async () => {
    if (!runner) {
      log.info({ appId, deploymentId }, 'deploy pipeline not wired yet (phase 4) — row stays queued');
      return;
    }
    await runner(appId, deploymentId);
  });
};

// 05 §4 teardown, in order: compose down --rmi local, vhosts + reload, /data + logs.
// Idempotent: every step tolerates resources that are already gone.
export const teardownApp = async (app: { id: string; slug: string; hosts: string[]; deploymentIds: string[] }): Promise<void> => {
  await compose(app.slug, ['down'], { rmi: true });
  await removeVhosts(app.hosts);
  await removeAppData(app.slug, app.deploymentIds);
};
