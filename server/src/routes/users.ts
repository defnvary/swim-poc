import { Router } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { Op, type Model, type ModelStatic } from 'sequelize';
import { db } from '../db/sequelize.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';
import { event } from '../services/audit.js';

export const usersRouter = Router();

const roleSchema = z.enum(['admin', 'member', 'viewer']);
type Role = z.infer<typeof roleSchema>;

interface UserInstance extends Model {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
interface TokenInstance extends Model {}
const Users = db.User as unknown as ModelStatic<UserInstance>;
const Tokens = db.RefreshToken as unknown as ModelStatic<TokenInstance>;

// 06 §4 — admin only
usersRouter.use(requireAuth, requireRole('admin'));

const revokeAllTokens = (userId: string) =>
  Tokens.update({ revokedAt: new Date() }, { where: { userId, revokedAt: null } });

const userJson = (u: UserInstance) => ({
  id: u.id,
  username: u.username,
  role: u.role,
  active: u.active,
  createdAt: u.createdAt.toISOString(),
});

const paginationSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

usersRouter.get('/', async (req, res) => {
  const { page, limit } = paginationSchema.parse(req.query);
  const { rows, count } = await Users.findAndCountAll({
    order: [['createdAt', 'DESC']],
    offset: (page - 1) * limit,
    limit,
  });
  res.json({ data: rows.map(userJson), meta: { page, limit, total: count } });
});

usersRouter.post('/', async (req, res) => {
  const body = z
    .object({ username: z.string().min(1), password: z.string().min(10), role: roleSchema })
    .strict()
    .parse(req.body);
  if (await Users.count({ where: { username: body.username } })) {
    throw new HttpError(409, 'conflict', 'username already taken');
  }
  const user = await Users.create({
    username: body.username,
    passwordHash: await argon2.hash(body.password),
    role: body.role,
  });
  await event('user.created', { userId: req.user!.id, targetType: 'user', targetId: user.id }, { username: user.username });
  res.status(201).json(userJson(user));
});

usersRouter.patch('/:id', async (req, res) => {
  const body = z
    .object({ role: roleSchema, active: z.boolean(), password: z.string().min(10) })
    .partial()
    .refine((b) => Object.keys(b).length > 0, { message: 'at least one field required' })
    .strict()
    .parse(req.body);
  const user = await Users.findByPk(req.params.id);
  if (!user) throw new HttpError(404, 'not_found', 'user not found');

  const isSelf = user.id === req.user!.id;
  if (isSelf && body.active === false) throw new HttpError(409, 'conflict', 'cannot deactivate your own account');
  if (isSelf && body.role !== undefined && body.role !== user.role) {
    throw new HttpError(409, 'conflict', 'cannot demote your own account');
  }
  const demoting = user.role === 'admin' && user.active && ((body.role !== undefined && body.role !== 'admin') || body.active === false);
  if (demoting) {
    const otherActiveAdmins = await Users.count({
      where: { role: 'admin', active: true, id: { [Op.ne]: user.id } },
    });
    if (otherActiveAdmins === 0) throw new HttpError(409, 'conflict', 'cannot demote or deactivate the last active admin');
  }

  const patch: Record<string, unknown> = {};
  if (body.role !== undefined) patch.role = body.role;
  if (body.active !== undefined) patch.active = body.active;
  if (body.password !== undefined) patch.passwordHash = await argon2.hash(body.password);
  await user.update(patch);

  if (body.password !== undefined) await revokeAllTokens(user.id); // 10 §2
  if (body.active === false) await revokeAllTokens(user.id);

  if (body.active === true) await event('user.activated', { userId: req.user!.id, targetType: 'user', targetId: user.id });
  else if (body.active === false) await event('user.deactivated', { userId: req.user!.id, targetType: 'user', targetId: user.id });
  else await event('user.updated', { userId: req.user!.id, targetType: 'user', targetId: user.id });

  res.json(userJson(user));
});

// 05 §4: soft delete — deactivate + revoke tokens, row stays for the audit trail
usersRouter.delete('/:id', async (req, res) => {
  const user = await Users.findByPk(req.params.id);
  if (!user) throw new HttpError(404, 'not_found', 'user not found');
  if (user.id === req.user!.id) throw new HttpError(409, 'conflict', 'cannot deactivate your own account');
  if (user.role === 'admin' && user.active) {
    const otherActiveAdmins = await Users.count({
      where: { role: 'admin', active: true, id: { [Op.ne]: user.id } },
    });
    if (otherActiveAdmins === 0) throw new HttpError(409, 'conflict', 'cannot deactivate the last active admin');
  }
  await user.update({ active: false });
  await revokeAllTokens(user.id);
  await event('user.deactivated', { userId: req.user!.id, targetType: 'user', targetId: user.id });
  res.status(204).end();
});
