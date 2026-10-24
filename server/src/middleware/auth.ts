import type { NextFunction, Request, Response } from 'express';
import type { Model, ModelStatic } from 'sequelize';
import { db } from '../db/sequelize.js';
import { verifyAccessToken } from '../lib/jwt.js';
import { HttpError } from './error.js';

export interface AuthUser {
  id: string;
  username: string;
  role: 'admin' | 'member' | 'viewer';
  active: boolean;
}

interface UserInstance extends Model {
  id: string;
  username: string;
  role: AuthUser['role'];
  active: boolean;
}
const Users = db.User as unknown as ModelStatic<UserInstance>;

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

// Bearer JWT (06 §1); deactivation takes effect on the next request, not at token expiry (10 §2)
export const requireAuth = async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new HttpError(401, 'unauthorized', 'missing bearer token');
  }
  let sub: string | undefined;
  try {
    const payload = await verifyAccessToken(header.slice('Bearer '.length));
    sub = payload.sub;
  } catch {
    throw new HttpError(401, 'unauthorized', 'invalid token');
  }
  const user = sub ? await Users.findByPk(sub) : null;
  if (!user) throw new HttpError(401, 'unauthorized', 'invalid token');
  if (!user.active) throw new HttpError(403, 'forbidden', 'user is inactive');
  req.user = { id: user.id, username: user.username, role: user.role, active: user.active };
  next();
};

export const requireRole = (...roles: AuthUser['role'][]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user || !roles.includes(req.user.role)) {
    throw new HttpError(403, 'forbidden', 'insufficient role');
  }
  next();
};
