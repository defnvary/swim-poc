import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { pino } from 'pino';

const log = pino({ level: 'info' });

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

// 06 §1: every error response is { "error": { code, message, details? } } — never a stack trace
export const errorMiddleware = (err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: {
        code: 'validation_failed',
        message: 'validation failed',
        details: { issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      },
    });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: { code: 'malformed_json', message: 'malformed JSON body' } });
  }
  log.error({ err });
  return res.status(500).json({ error: { code: 'internal', message: 'internal server error' } });
};
