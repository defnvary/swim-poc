import express from 'express';
import helmet from 'helmet';
import pino from 'pino';
import { sequelize } from './db/sequelize.js';

const log = pino({ level: 'info' });
const VERSION = '1.0.0';

const app = express();
app.use(helmet());

// 06 §11 — public, no auth, checked by the swim-api Docker healthcheck
app.get('/api/health', async (_req, res) => {
  try {
    await sequelize.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok', version: VERSION });
  } catch {
    res.status(500).json({ status: 'error', db: 'down', version: VERSION });
  }
});

const start = async () => {
  try {
    await sequelize.authenticate();
    log.info('db connected');
  } catch (err) {
    log.error({ err }, 'db unavailable at boot');
  }
  app.listen(3000, () => log.info('api listening on :3000'));
};

void start();
