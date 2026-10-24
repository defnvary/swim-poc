import { Router } from 'express';
import type { Model, ModelStatic } from 'sequelize';
import { z } from 'zod';
import { db } from '../db/sequelize.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';
import { createManualDeployment, type AppLite } from './deployments.js';
import { event } from '../services/audit.js';

export const envRouter = Router({ mergeParams: true }); // /api/apps/:id/env

interface EnvInstance extends Model {
  appId: string;
  key: string;
  valueEnc: string;
}
const EnvVars = db.EnvVar as unknown as ModelStatic<EnvInstance>;
const Apps = db.App as unknown as ModelStatic<AppLite>;

const requireMember = requireRole('member', 'admin');

// GET — viewers see masked, member/admin plaintext (06 §9)
envRouter.get('/', async (req, res) => {
  const app = await Apps.findByPk(String((req.params as Record<string, string>).id));
  if (!app) throw new HttpError(404, 'not_found', 'app not found');
  const rows = await EnvVars.findAll({ where: { appId: app.id }, order: [['key', 'ASC']] });
  if (req.user!.role === 'viewer') {
    res.json(rows.map((r) => ({ key: r.key, masked: true })));
  } else {
    res.json(rows.map((r) => ({ key: r.key, value: decrypt(r.valueEnc) })));
  }
});

// PUT — replace-all; applyNow triggers a manual deploy of the current commit (06 §9)
envRouter.put('/', requireMember, async (req, res) => {
  const body = z
    .object({
      vars: z
        .array(
          z
            .object({
              key: z.string().regex(/^[A-Z_][A-Z0-9_]*$/), // 05 §2
              value: z.string().max(10 * 1024),
            })
            .strict(),
        )
        .max(200),
      applyNow: z.boolean().default(false),
    })
    .strict()
    .parse(req.body);

  const app = await Apps.findByPk(String((req.params as Record<string, string>).id));
  if (!app) throw new HttpError(404, 'not_found', 'app not found');

  const existing = await EnvVars.findAll({ where: { appId: app.id } });
  const nextKeys = new Set(body.vars.map((v) => v.key));
  for (const row of existing) {
    if (!nextKeys.has(row.key)) await row.destroy();
  }
  for (const v of body.vars) {
    const valueEnc = encrypt(v.value);
    const row = existing.find((r) => r.key === v.key);
    if (row) await row.update({ valueEnc });
    else await EnvVars.create({ appId: app.id, key: v.key, valueEnc });
  }
  await event('env.updated', { userId: req.user!.id, targetType: 'app', targetId: app.id }, { count: body.vars.length });

  let redeployTriggered = false;
  if (body.applyNow) {
    await createManualDeployment(app, req.user!.id, null);
    redeployTriggered = true;
  }
  res.json({ applied: body.vars.length, redeployTriggered });
});
