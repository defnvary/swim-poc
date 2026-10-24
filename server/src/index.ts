import express from 'express';
import helmet from 'helmet';
import { pino } from 'pino';
import { sequelize } from './db/sequelize.js';
import { appsRouter } from './routes/apps.js';
import { authRouter } from './routes/auth.js';
import { deploymentsGlobalRouter, deploymentsRouter } from './routes/deployments.js';
import { domainsAppRouter, domainsGlobalRouter } from './routes/domains.js';
import { envRouter } from './routes/env.js';
import { eventsRouter } from './routes/events.js';
import { hooksRouter } from './routes/hooks.js';
import { logsRouter } from './routes/logs.js';
import { usersRouter } from './routes/users.js';
import { errorMiddleware } from './middleware/error.js';
import { apiLimiter } from './middleware/rate-limit.js';
import { runDeployment } from './services/deploy.js';
import { recoverOnBoot, setDeployRunner } from './services/deploy-queue.js';

const log = pino({ level: 'info' });
const VERSION = '1.0.0';

// 04 §2 order: helmet → rate limits → /api routers → static SPA (phase 6) → 404 → error middleware
export const app = express();
app.use(helmet());

// 06 §12/§14: hooks read the RAW body and use their own limiter — mount before
// express.json and before the apiLimiter (hooks are exempt from it).
app.use('/api/hooks', hooksRouter);

app.use(express.json());

// 06 §11 — public, no auth, exempt from the api limiter, checked by the swim-api Docker healthcheck
app.get('/api/health', async (_req, res) => {
  try {
    await sequelize.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok', version: VERSION });
  } catch {
    res.status(500).json({ status: 'error', db: 'down', version: VERSION });
  }
});

app.use('/api', apiLimiter);
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/events', eventsRouter);
app.use('/api/apps', appsRouter);
app.use('/api/apps/:id/deployments', deploymentsRouter);
app.use('/api/deployments', deploymentsGlobalRouter);
app.use('/api/apps/:id/logs', logsRouter);
app.use('/api/apps/:id/domains', domainsAppRouter);
app.use('/api/domains', domainsGlobalRouter);
app.use('/api/apps/:id/env', envRouter);

app.use((_req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'not found' } });
});

app.use(errorMiddleware);

const start = async () => {
  try {
    await sequelize.authenticate();
    log.info('db connected');
  } catch (err) {
    log.error({ err }, 'db unavailable at boot');
  }
  // 07 §2: the pipeline runs only in the real process — tests import `app` without
  // start(), so the seam stays unwired and queued rows stay queued (11 §4).
  setDeployRunner(runDeployment);
  // Full boot reconciliation (07 §10) is phase 6; the queue part is here (07 §2).
  try {
    await recoverOnBoot();
  } catch (err) {
    log.error({ err }, 'deploy queue recovery failed at boot');
  }
  app.listen(3000, () => log.info('api listening on :3000'));
};

// CLI entry: run boot + listen only when executed as the program, not when imported (tests)
if (process.argv[1]?.includes('index')) void start();
