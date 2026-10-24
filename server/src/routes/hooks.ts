import { createHmac, timingSafeEqual } from 'node:crypto';
import express, { Router } from 'express';
import type { Model, ModelStatic } from 'sequelize';
import { db } from '../db/sequelize.js';
import { decrypt } from '../lib/crypto.js';
import { HttpError } from '../middleware/error.js';
import { hookLimiter } from '../middleware/rate-limit.js';
import { queueDeployment } from '../services/deploy-queue.js';
import { event } from '../services/audit.js';

export const hooksRouter = Router();

interface HookAppInstance extends Model {
  id: string;
  branch: string;
  autoDeploy: boolean;
  webhookSecretEnc: string;
}
interface DeploymentLite extends Model {
  id: string;
}
const Apps = db.App as unknown as ModelStatic<HookAppInstance>;
const Deployments = db.Deployment as unknown as ModelStatic<DeploymentLite>;

const HEAD_SHA = '0'.repeat(40);

// 06 §12: verification runs on the RAW body, before any JSON parsing (10 §6)
hooksRouter.use(hookLimiter, express.raw({ type: 'application/json' }));

const badSignature = (reason = 'bad_signature'): HttpError => new HttpError(401, 'bad_signature', reason);

const signatureOk = (secret: string, raw: Buffer, header: string | undefined): boolean => {
  if (!header?.startsWith('sha256=')) return false;
  const provided = Buffer.from(header.slice('sha256='.length), 'hex');
  const expected = createHmac('sha256', secret).update(raw).digest();
  return provided.length === expected.length && timingSafeEqual(provided, expected); // constant-time (10 §6)
};

// 10 §6: hookId is the capability — unknown id 404s before any secret handling.
// GitHub must get a fast answer: verify, enqueue, 202 — never block on the deploy.
hooksRouter.post('/:hookId', async (req, res) => {
  const app = await Apps.findOne({ where: { hookId: String((req.params as Record<string, string>).hookId) } });
  if (!app) throw new HttpError(404, 'hook_not_found', 'hook_not_found');

  const raw = req.body as Buffer;
  if (!Buffer.isBuffer(raw) || !signatureOk(decrypt(app.webhookSecretEnc), raw, req.get('X-Hub-Signature-256'))) {
    throw badSignature();
  }

  let payload: { ref?: string };
  try {
    payload = JSON.parse(raw.toString('utf8')) as { ref?: string };
  } catch {
    throw badSignature('body is not valid JSON');
  }

  const ghEvent = req.get('X-GitHub-Event');
  if (ghEvent === 'ping') return void res.json({ ignored: 'ping' });
  if (ghEvent !== 'push') return void res.json({ ignored: 'event' });
  if (payload.ref !== `refs/heads/${app.branch}`) return void res.json({ ignored: 'branch' }); // tracked branch HEAD as git reports it; payload SHA ignored (10 §6)
  if (!app.autoDeploy) return void res.json({ ignored: 'auto_deploy_disabled' });

  const deployment = await Deployments.create({
    appId: app.id,
    commitSha: HEAD_SHA, // resolved to real HEAD by the pipeline at fetch time (07 §3)
    branch: app.branch,
    status: 'queued',
    trigger: 'webhook',
  });
  await event('deploy.queued', { targetType: 'deployment', targetId: deployment.id }, { trigger: 'webhook', sha: HEAD_SHA });
  // webhooks are always accepted and queued — never 409 (07 §2)
  void queueDeployment(app.id, String(deployment.id));
  res.status(202).json({ deploymentId: deployment.id });
});
