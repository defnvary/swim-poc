import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config.js';

// 06 §14 presets. The default in-memory store is per-process — correct for one api (01).
// Skipped under NODE_ENV=test so integration suites can drive the endpoints (11 §4).
// ipKeyGenerator is the library's required helper for stringifying IPv6 request IPs.
const base = {
  windowMs: 60_000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.nodeEnv === 'test',
  message: { error: { code: 'rate_limited', message: 'Too many requests' } },
};

export const authLimiter = rateLimit({ ...base, limit: 10 }); // per IP

export const apiLimiter = rateLimit({
  ...base,
  limit: 300,
  keyGenerator: (req) => req.user?.id ?? (req.ip ? ipKeyGenerator(req.ip) : 'unknown'), // per user once authenticated, IP fallback
});

export const hookLimiter = rateLimit({
  ...base,
  limit: 60,
  keyGenerator: (req) => (typeof req.params.hookId === 'string' ? req.params.hookId : req.ip ? ipKeyGenerator(req.ip) : 'unknown'), // per hookId — used by routes/hooks (phase 4)
});
