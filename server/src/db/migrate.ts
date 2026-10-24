import { Umzug, SequelizeStorage } from 'umzug';
import { pino } from 'pino';
import { fileURLToPath } from 'node:url';
import { sequelize } from './sequelize.js';

export type Migration = (m: { context: { query: (sql: string) => Promise<unknown> } }) => Promise<void>;

export const migrator = new Umzug({
  migrations: { glob: ['migrations/*.{js,ts}', { cwd: fileURLToPath(new URL('./', import.meta.url)) }] },
  context: { query: (sql: string) => sequelize.query(sql) },
  storage: new SequelizeStorage({ sequelize }),
  logger: pino({ level: 'info' }), // required by umzug's types (docs listing omits it)
});

// CLI: npm -w server run migrate (tsx locally) | node dist/db/migrate.js (in the image)
if (process.argv[1]?.includes('migrate')) await migrator.up();
