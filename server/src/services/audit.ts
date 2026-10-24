import { db } from '../db/sequelize.js';

export interface EventCtx {
  userId?: string | null;
  targetType?: 'user' | 'app' | 'deployment' | 'domain' | null;
  targetId?: string | null;
}

// 04 §2: insert row, never throws — a failed event write must not fail the request (10 §9)
export const event = async (
  action: string,
  ctx: EventCtx = {},
  details?: Record<string, unknown>,
): Promise<void> => {
  try {
    await db.Event.create({
      action,
      userId: ctx.userId ?? null,
      targetType: ctx.targetType ?? null,
      targetId: ctx.targetId ?? null,
      details: details ?? null,
    });
  } catch {
    // audit is best-effort by contract
  }
};
