// server/src/db/sequelize.ts — the one Sequelize instance + typed model registry
import { Sequelize } from 'sequelize';
import { config } from '../config.js';
import { defineModels } from './models.js';

export const sequelize = new Sequelize(config.databaseUrl, {
  dialect: 'postgres',
  logging: false, // never log queries by default
  pool: { max: 10, idle: 30_000 },
});

export const db = defineModels(sequelize); // { User, RefreshToken, App, Deployment, Domain, EnvVar, Event }
