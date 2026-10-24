# 05 — Database Schema

`server/src/db/models.ts` is the single source of truth for all persisted shapes; `server/src/db/migrations/` holds the matching DDL as plain SQL migrations run by umzug at container start. The listings below are complete — implement them verbatim. No raw SQL outside migration files.

## 1. Instance & models (complete)

```typescript
// server/src/db/sequelize.ts — the one Sequelize instance + typed model registry
import { Sequelize } from 'sequelize';
import { config } from '../config.js';
import { defineModels } from './models.js';

export const sequelize = new Sequelize(config.databaseUrl, {
  dialect: 'postgres',
  logging: false,                  // never log queries by default
  pool: { max: 10, idle: 30_000 },
});

export const db = defineModels(sequelize); // { User, RefreshToken, App, Deployment, Domain, EnvVar, Event }
```

```typescript
// server/src/db/models.ts — single source of truth for data shapes
import { DataTypes, type Sequelize } from 'sequelize';

export const defineModels = (sequelize: Sequelize) => {
  const User = sequelize.define('User', {
    id:           { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    username:     { type: DataTypes.STRING, allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    role:         { type: DataTypes.ENUM('admin', 'member', 'viewer'), allowNull: false, defaultValue: 'member' },
    active:       { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  });

  const RefreshToken = sequelize.define('RefreshToken', {
    id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    familyId:  { type: DataTypes.UUID, allowNull: false },
    userId:    { type: DataTypes.UUID, allowNull: false },
    tokenHash: { type: DataTypes.STRING, allowNull: false, unique: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    revokedAt: { type: DataTypes.DATE, allowNull: true },
  }, { updatedAt: false, indexes: [{ fields: ['familyId'] }] });

  const App = sequelize.define('App', {
    id:                  { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name:                { type: DataTypes.STRING, allowNull: false },
    slug:                { type: DataTypes.STRING, allowNull: false, unique: true },
    repoOwner:           { type: DataTypes.STRING, allowNull: false },
    repoName:            { type: DataTypes.STRING, allowNull: false },
    branch:              { type: DataTypes.STRING, allowNull: false, defaultValue: 'main' },
    port:                { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3000 },
    healthcheckPath:     { type: DataTypes.STRING, allowNull: false, defaultValue: '/' },
    buildType:           { type: DataTypes.ENUM('auto', 'dockerfile', 'node', 'static'), allowNull: false, defaultValue: 'auto' },
    autoDeploy:          { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    accessTokenEnc:      { type: DataTypes.STRING, allowNull: true },   // fine-grained PAT, AES-256-GCM
    webhookSecretEnc:    { type: DataTypes.STRING, allowNull: false },  // AES-256-GCM
    hookId:              { type: DataTypes.UUID, allowNull: false, unique: true },
    status:              { type: DataTypes.ENUM('created', 'building', 'live', 'failed', 'stopped'), allowNull: false, defaultValue: 'created' },
    currentDeploymentId: { type: DataTypes.UUID, allowNull: true },
    createdById:         { type: DataTypes.UUID, allowNull: false },
  }, { indexes: [{ fields: ['createdById'] }] });

  const Deployment = sequelize.define('Deployment', {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    appId:         { type: DataTypes.UUID, allowNull: false },
    commitSha:     { type: DataTypes.CHAR(40), allowNull: false },
    commitMessage: { type: DataTypes.STRING, allowNull: true },
    author:        { type: DataTypes.STRING, allowNull: true },
    branch:        { type: DataTypes.STRING, allowNull: false },
    status:        { type: DataTypes.ENUM('queued', 'fetching', 'building', 'deploying', 'live', 'failed'), allowNull: false, defaultValue: 'queued' },
    trigger:       { type: DataTypes.ENUM('webhook', 'manual'), allowNull: false },
    userId:        { type: DataTypes.UUID, allowNull: true },
    error:         { type: DataTypes.TEXT, allowNull: true },
    startedAt:     { type: DataTypes.DATE, allowNull: true },
    finishedAt:    { type: DataTypes.DATE, allowNull: true },
  }, { updatedAt: false, indexes: [{ fields: ['appId', 'createdAt'] }, { fields: ['status'] }] });

  const Domain = sequelize.define('Domain', {
    id:           { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    appId:        { type: DataTypes.UUID, allowNull: false },
    host:         { type: DataTypes.STRING, allowNull: false, unique: true },
    certStatus:   { type: DataTypes.ENUM('pending', 'issued', 'failed'), allowNull: false, defaultValue: 'pending' },
    certIssuedAt: { type: DataTypes.DATE, allowNull: true },
  }, { updatedAt: false, indexes: [{ fields: ['appId'] }] });

  const EnvVar = sequelize.define('EnvVar', {
    appId:    { type: DataTypes.UUID, allowNull: false, primaryKey: true },
    key:      { type: DataTypes.STRING, allowNull: false, primaryKey: true },
    valueEnc: { type: DataTypes.STRING, allowNull: false },  // AES-256-GCM
  }, { createdAt: false });

  const Event = sequelize.define('Event', {
    id:         { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId:     { type: DataTypes.UUID, allowNull: true },
    action:     { type: DataTypes.STRING, allowNull: false },
    targetType: { type: DataTypes.STRING, allowNull: true },
    targetId:   { type: DataTypes.STRING, allowNull: true },
    details:    { type: DataTypes.JSONB, allowNull: true },
  }, { updatedAt: false, indexes: [{ fields: ['createdAt'] }, { fields: ['action'] }] });

  // associations — query convenience (include/joins); FK constraints live in the migrations
  User.hasMany(RefreshToken, { foreignKey: 'userId', onDelete: 'CASCADE' });
  RefreshToken.belongsTo(User, { foreignKey: 'userId', onDelete: 'CASCADE' });
  User.hasMany(App, { foreignKey: 'createdById' });               // users are never deleted (§4)
  App.belongsTo(User, { as: 'createdBy', foreignKey: 'createdById' });
  App.hasMany(Deployment, { foreignKey: 'appId', onDelete: 'CASCADE' });
  Deployment.belongsTo(App, { foreignKey: 'appId', onDelete: 'CASCADE' });
  App.hasMany(Domain, { foreignKey: 'appId', onDelete: 'CASCADE' });
  Domain.belongsTo(App, { foreignKey: 'appId', onDelete: 'CASCADE' });
  App.hasMany(EnvVar, { foreignKey: 'appId', onDelete: 'CASCADE' });
  App.belongsTo(Deployment, { as: 'currentDeployment', foreignKey: 'currentDeploymentId' }); // no cascade
  User.hasMany(Deployment, { foreignKey: 'userId' });
  Event.belongsTo(User, { foreignKey: 'userId', onDelete: 'SET NULL' });

  return { User, RefreshToken, App, Deployment, Domain, EnvVar, Event };
};
```

Conventions:

- Sequelize defaults are kept: pluralized table names (`Users`, `RefreshTokens`, `Apps`, `Deployments`, `Domains`, `EnvVars`, `Events`) and automatic `createdAt`/`updatedAt` columns — no renaming, no `paranoid` soft deletes (deactivation is explicit, §4). Models whose contract has no `updatedAt` disable it via `{ updatedAt: false }`; `EnvVar` conversely sets `{ createdAt: false }`.
- `db` from `db/sequelize.ts` is the only handle the app uses; nothing else instantiates Sequelize (tests reuse it against their own database).
- Associations exist for query convenience (`include`); FK constraints, cascade rules, and indexes are created by the migrations and must mirror this file exactly — a mismatch is a bug.
- Models never touch the wire: route handlers build the JSON shapes of `06` themselves.

## 2. Field notes

| Field | Format / rule |
|---|---|
| `User.passwordHash` | argon2id encoded string from the `argon2` package (memory 64 MB, iterations 3, parallelism 1 — library defaults are acceptable) |
| `App.slug` | `[a-z0-9-]{3,30}`, derived from name then uniquified with `-2`, `-3`, …; used in container names, image tags, domains, and file paths |
| `App.hookId` | UUID v4 generated at creation; the public path segment of the webhook URL. Rotating the hook = new `hookId` + new secret together |
| `App.accessTokenEnc` | `lib/crypto.ts` envelope `v1:<iv>:<tag>:<ct>`; plaintext never logged; API returns only `{present: boolean, last4}` |
| `App.webhookSecretEnc` | same envelope; plaintext returned only on create/rotate responses |
| `App.currentDeploymentId` | points at the newest deployment with `status = live`; kept intact when a later deploy fails (that's the "last good" record) |
| `Deployment.commitSha` | full 40-char SHA-1 hex; the built image tag is the first 8 chars |
| `EnvVar.valueEnc` | same crypto envelope; `key` is plaintext (names aren't secret); keys must match `^[A-Z_][A-Z0-9_]*$` and are rejected with 422 otherwise |
| `Event.action` | dotted vocabulary below |

## 3. Refresh-token rotation (implements FR-1 reuse detection)

1. Login creates a `RefreshToken` row: `id = familyId = uuid()`, `tokenHash = sha256(random 256-bit token)`, `expiresAt = now + 7d`, cookie value is the raw token (httpOnly).
2. `POST /api/auth/refresh` with a valid, unrevoked token: revoke it (`revokedAt = now`), insert a successor with the **same `familyId`**, issue a new access token.
3. Refresh presenting a token that is revoked or already rotated: **reuse detected** → revoke the whole family in one update (`db.RefreshToken.update({ revokedAt: now }, { where: { familyId, revokedAt: null } })`), reject with 401.
4. Logout revokes the presented token only. Password reset / user deactivation revokes all the user's tokens.
5. Daily timer prunes rows with `expiresAt < now() - 30d`.

## 4. Deletion semantics

- **User**: never hard-deleted (FK references from deployments/events). Deactivation sets `active = false` (login and refresh rejected with 401/403), revokes all tokens.
- **App**: hard delete cascades `deployments`, `domains`, `envVars`. Before the DB delete, `routes/apps.ts` runs the teardown: `docker compose down --rmi local` for the project, removes the app's vhost files + reload, deletes `/data/apps/<slug>` and deployment log files, then `db.App.destroy({ where: { id } })` (FK cascades do the rest). `Event` rows keep the audit trail (nullable `userId` stays).
- **Domain**: row delete removes the vhost + reload first. Cert files are left in place (certbot's problem dir is self-managed).
- **Deployment**: rows are retained; only their **log files** are pruned (see §6).

## 5. Event action vocabulary (write exactly these strings)

```text
auth.login, auth.login_failed, auth.logout, auth.token_reuse,
setup.completed,
user.created, user.updated, user.deactivated, user.activated,
app.created, app.updated, app.deleted, app.stopped, app.started,
deploy.queued (details: trigger, sha), deploy.live, deploy.failed (details: error),
domain.added, domain.removed, domain.cert_issued, domain.cert_failed,
env.updated, hook.rotated
```

`targetType` is one of `user | app | deployment | domain`; `details` carries a small JSON object (e.g. `{"sha": "…", "host": "…"}`).

## 6. Retention (enforced by the daily timer in `services/certs.ts`, alongside renewal)

| Artifact | Retention |
|---|---|
| Deployment log files (`/data/logs/deployments/<id>.log`) | keep newest 50 per app; DB rows keep their metadata |
| Docker images per app | keep newest 5 tags (`swim/<slug>:<sha8>`); pruned by the same timer, see `08-docker-strategy.md` |
| Events | delete `createdAt < now - 180d` |
| Refresh tokens | see §3 step 5 |

## 7. Migrations (umzug)

Migration files live in `server/src/db/migrations/`, named `<YYYYMMDDHHMMSS>-<name>.ts`. Each exports `up`/`down` running plain SQL through the shared sequelize instance:

```typescript
// server/src/db/migrations/20260101000000-init.ts — the only migration at release
import type { Migration } from '../migrate.js';

export const up: Migration = ({ context }) => context.query(`
  -- CREATE TYPE for the six enums (user role, app status, build type,
  -- deploy status, deploy trigger, cert status) and CREATE TABLE for all
  -- seven tables: every column of §1, FK constraints with the cascade rules
  -- of §4, and the indexes of §1. Shape of one table:
  --
  -- CREATE TABLE "Users" (
  --   "id" UUID PRIMARY KEY,
  --   "username" VARCHAR(255) NOT NULL UNIQUE,
  --   "passwordHash" VARCHAR(255) NOT NULL,
  --   "role" "enum_Users_role" NOT NULL DEFAULT 'member',
  --   "active" BOOLEAN NOT NULL DEFAULT true,
  --   "createdAt" TIMESTAMPTZ NOT NULL,
  --   "updatedAt" TIMESTAMPTZ NOT NULL
  -- );
`);

export const down: Migration = ({ context }) => context.query(`
  DROP TABLE IF EXISTS "Events", "EnvVars", "Domains", "Deployments", "Apps", "RefreshTokens", "Users" CASCADE;
  DROP TYPE IF EXISTS "enum_Users_role"; -- ...and the other five
`);
```

Runner and CLI (`server/src/db/migrate.ts`):

```typescript
import { Umzug, SequelizeStorage } from 'umzug';
import { sequelize } from './sequelize.js';

export type Migration = (m: { context: { query: (sql: string) => Promise<unknown> } }) => Promise<void>;

export const migrator = new Umzug({
  migrations: { glob: ['migrations/*.{js,ts}', { cwd: new URL('./', import.meta.url) }] },
  context: { query: (sql: string) => sequelize.query(sql) },
  storage: new SequelizeStorage({ sequelize }),
});

// CLI: npm -w server run migrate (tsx locally) | node dist/db/migrate.js (in the image)
if (process.argv[1]?.includes('migrate')) await migrator.up();
```

- Author locally: write the new file, run `npm -w server run migrate` (server script: `"migrate": "tsx src/db/migrate.ts"`) against a throwaway Postgres, commit the file.
- Apply in production: the api container CMD runs `node dist/db/migrate.js` before `node dist/index.js` (08 §3) — no manual step, safe to re-run, boots block until the schema is current (umzug's `SequelizeMeta` table records applied migrations).
- Never edit an applied migration; always add a new one.
- `sequelize.sync()` is forbidden anywhere — schema changes go through migrations only.

Next: `06-api-specification.md`.
