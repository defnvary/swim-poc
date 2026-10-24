import { randomBytes } from 'node:crypto';

let prepared = false;

// 11 §5: assert DATABASE_URL, run umzug migrations, inject fixed throwaway values
// for the SWIM_* keys so integration tests import config.ts unchanged.
// Vitest workers are separate processes without a hook registry in the default config,
// so this is called at the top of each api test file (migrations are idempotent).
export const prepareTestEnv = async (): Promise<void> => {
  if (prepared) return;
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set for integration tests (11 §5)');
  }
  process.env.SWIM_DOMAIN ||= 'swim.test';
  process.env.SWIM_ACME_EMAIL ||= 'admin@swim.test';
  process.env.SWIM_SECRET_KEY ||= randomBytes(32).toString('base64');
  process.env.SWIM_JWT_SECRET ||= randomBytes(32).toString('base64');
  process.env.NODE_ENV ||= 'test';

  const { sequelize } = await import('../src/db/sequelize.js');
  const { migrator } = await import('../src/db/migrate.js');
  await sequelize.query('SELECT pg_advisory_lock(75512057)'); // serialize parallel workers racing into umzug
  try {
    await migrator.up();
  } finally {
    await sequelize.query('SELECT pg_advisory_unlock(75512057)');
  }
  prepared = true;
};

// 11 §4: every suite truncates all tables in beforeEach
export const truncateAll = async (): Promise<void> => {
  const { sequelize } = await import('../src/db/sequelize.js');
  await sequelize.query(
    `TRUNCATE "Events", "EnvVars", "Domains", "Deployments", "Apps", "RefreshTokens", "Users" RESTART IDENTITY CASCADE`,
  );
};
