import { resolve } from 'node:path';
import { z } from 'zod';

// base64 string that decodes to exactly `bytes` (or at least, when min) or more bytes
const base64Key = (bytes: number, min: boolean) =>
  z.string().refine(
    (v) => {
      const buf = Buffer.from(v, 'base64');
      return buf.toString('base64') === v && (min ? buf.length >= bytes : buf.length === bytes);
    },
    `base64 of ${min ? '' : 'exactly '}${bytes} bytes`,
  );

const envSchema = z
  .object({
    SWIM_DOMAIN: z.string().min(1).optional(),
    SWIM_ACME_EMAIL: z.string().email().optional(),
    SWIM_SECRET_KEY: base64Key(32, false).optional(),
    SWIM_JWT_SECRET: base64Key(32, true).optional(),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
    POSTGRES_PASSWORD: z.string().min(1).optional(),
    DOCKER_GID: z.coerce.number().int().nonnegative().optional(),
    SWIM_DEPLOY_TIMEOUT: z.coerce.number().int().positive().default(120),
    SWIM_MAX_BUILDS: z.coerce.number().int().positive().default(2),
    SWIM_DATA_DIR: z.string().min(1).default('/data'),
    NODE_ENV: z.enum(['production', 'development', 'test']).default('development'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['SWIM_DOMAIN', 'SWIM_ACME_EMAIL', 'SWIM_SECRET_KEY', 'SWIM_JWT_SECRET', 'POSTGRES_PASSWORD', 'DOCKER_GID'] as const) {
      if (env[key] === undefined) ctx.addIssue({ code: 'custom', message: `${key} is required in production` });
    }
  });

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}

export const config = {
  swimDomain: parsed.data.SWIM_DOMAIN,
  acmeEmail: parsed.data.SWIM_ACME_EMAIL,
  secretKey: parsed.data.SWIM_SECRET_KEY,
  jwtSecret: parsed.data.SWIM_JWT_SECRET,
  databaseUrl: parsed.data.DATABASE_URL,
  postgresPassword: parsed.data.POSTGRES_PASSWORD,
  dockerGid: parsed.data.DOCKER_GID,
  deployTimeoutSeconds: parsed.data.SWIM_DEPLOY_TIMEOUT,
  maxBuilds: parsed.data.SWIM_MAX_BUILDS,
  // root for generated artifacts (01 §volumes). Production is the swim-data volume at /data;
  // SWIM_DATA_DIR lets a rootless dev box relocate it, e.g. ./data.
  dataDir: resolve(parsed.data.SWIM_DATA_DIR),
  nodeEnv: parsed.data.NODE_ENV,
};
export type Config = typeof config;
