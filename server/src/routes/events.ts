import { Router } from 'express';
import type { Model, ModelStatic } from 'sequelize';
import { z } from 'zod';
import { db } from '../db/sequelize.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const eventsRouter = Router();

interface EventInstance extends Model {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: unknown;
  createdAt: Date;
}
const Events = db.Event as unknown as ModelStatic<EventInstance>;

// 06 §10 — admin only
eventsRouter.use(requireAuth, requireRole('admin'));

eventsRouter.get('/', async (req, res) => {
  const query = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      action: z.string().optional(),
    })
    .strict()
    .parse(req.query);
  const { rows, count } = await Events.findAndCountAll({
    where: query.action ? { action: query.action } : {},
    order: [['createdAt', 'DESC']],
    offset: (query.page - 1) * query.limit,
    limit: query.limit,
    include: [{ model: db.User, attributes: ['username'] }],
  });
  res.json({
    data: rows.map((e) => {
      const related = e.get('User') as { username: string } | undefined;
      return {
        id: e.id,
        action: e.action,
        user: related ? { username: related.username } : null,
        targetType: e.targetType,
        targetId: e.targetId,
        details: e.details,
        createdAt: e.createdAt.toISOString(),
      };
    }),
    meta: { page: query.page, limit: query.limit, total: count },
  });
});
