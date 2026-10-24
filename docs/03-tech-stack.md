# 03 — Tech Stack

Every dependency is chosen for the smallest code volume that still satisfies `02-requirements.md`. The implementing agent must not add packages outside this list without a documented reason.

## 1. Version policy

- Majors below are **deliberate decisions** — do not change them.
- Before building, pin exact versions with `npm view <pkg> version` and record them in each `package.json`. Versions below were current at documentation time (Oct 2026).
- Use `^` ranges in `package.json` except for the platform Docker images, which are pinned in `docker-compose.yml`.

## 2. Server

| Layer | Choice | Version | Why
|---|---|---|---|
| Runtime | Node.js | 24 LTS (Alpine) | Active LTS; `node:24-alpine` base image |
| Language | TypeScript | ^5 (strict) | Type safety across API contract; shared types in dashboard where useful |
| Module system | ESM (`"type": "module"`) | — | Modern standard; one config everywhere |
| Framework | Express | ^5.3.0 | User requirement. v5: async error propagation, stable `path-to-regexp` |
| Validation | zod | ^4 | One schema language for request bodies, env config, and API docs |
| JWT | jose | ^6 | Standards-compliant, zero-dep, EdDSA/HS256 support |
| Password hashing | argon2 | latest | argon2id, one-line hash/verify; native prebuilds for Alpine |
| ORM / migrations | Sequelize + pg + umzug | ^6 / ^8 / ^3 | Models-as-code with typed queries (05 §1); umzug runs plain SQL migrations at container start (05 §7) — no CLI scaffolding, no codegen step |
| Dev runner | tsx | ^4 | Executes ESM TypeScript directly: dev watch and the local migrate CLI (05 §7) |
| Database | PostgreSQL | 17 (`postgres:17-alpine`) | User requirement; robust, boring, dump/restore story |
| Secrets crypto | node:crypto (built-in) | — | AES-256-GCM helpers, ~30 lines (`lib/crypto.ts`); no package needed |
| Logging | pino | ^9 | Structured JSON logs to stdout; `pino-pretty` in dev |
| HTTP hardening | helmet | ^8 | One line, sane defaults |
| Rate limiting | express-rate-limit | ^8 | Login/API/webhook limiter presets |
| Process output | child_process (`execa` optional; built-in `spawn` preferred) | — | `docker compose`, `git`, `docker logs`, `certbot` invocations |
| Exec/shell tooling in image | docker-cli, docker-cli-compose, git | apk packages | Lets the api container drive the host engine via the mounted socket |
| Tests | vitest + supertest | latest | Unit tests for crypto/webhook/queue logic + one API smoke suite; keep coverage focused, not exhaustive |

**Explicitly not used:** Docker SDK (`dockerode`) — the CLI is more transparent and less code; Redis — Postgres + in-process queue is sufficient at this scale; BullMQ — same reason; Passport — two endpoints don't need a framework; `sequelize-cli` — the programmatic umzug runner (05 §7) is less scaffolding and runs inside the container; class-validator/class-transformer — zod covers it.

## 3. Dashboard

| Layer | Choice | Version | Why
|---|---|---|---|
| UI runtime | React | ^19 | User requirement |
| Build tool | Vite | ^7 (or latest) | Fast default for SPA; minimal config |
| Component library | Material UI (`@mui/material`, `@mui/icons-material`, `@emotion/react`, `@emotion/styled`) | ^9.5 | User requirement; v9 supports React 19 natively |
| Routing | react-router | ^7 | De-facto standard; data APIs not required — plain routes suffice |
| Server state | @tanstack/react-query | ^5 | Caching, polling, mutations; eliminates most hand-rolled state |
| Client state | React context only | — | Auth context (tokens) — no Redux/Zustand needed |
| HTTP | fetch (built-in) | — | Typed wrapper + refresh interceptor + SSE reader; no axios |
| Toasts | notistack | ^3 | MUI-friendly snackbar queue |
| Forms | react-hook-form + @hookform/resolvers + zod | latest | One validation language shared with the server |
| Charts / dates | dayjs | latest | Deployment timestamps; no chart library in v1 |
| Tests | vitest + @testing-library/react | latest | Render smoke tests for key pages only |

**Explicitly not used:** CSS frameworks besides MUI's Emotion (no Tailwind), global state libraries, mock-server layers (use the real API in dev via Vite proxy), Redux, axios.

## 4. Infrastructure

| Piece | Choice | Version | Notes |
|---|---|---|---|
| Container runtime | Docker Engine | 27+ | Host-installed (official apt repo) |
| Orchestration | Docker Compose | v2 (plugin) | Both for the platform stack and generated per-app projects |
| Edge proxy | nginx | `nginx:1-alpine` (stable mainline tag) | TLS termination + vhosts, see `09-nginx-domains-ssl.md` |
| Certificates | certbot | `certbot/certbot` image (latest) | Spawned on demand by the api; HTTP-01 webroot |
| App base images (generated) | `node:24-alpine`, `nginx:1-alpine` | — | Used by the Node and static fallback Dockerfiles in `07-deploy-pipeline.md` |

## 5. Environment variables (server)

All read once in `config.ts` via a single zod schema and fail fast if invalid:

```text
SWIM_DOMAIN            base domain, e.g. example.com (platform host = swim.example.com)
SWIM_ACME_EMAIL        email for Let's Encrypt
SWIM_SECRET_KEY        base64, 32 bytes: AES-256-GCM key for PATs, webhook secrets, env values
SWIM_JWT_SECRET        base64, 32+ bytes: HS256 signing key
DATABASE_URL           postgres://swim:<password>@swim-db:5432/swim
POSTGRES_PASSWORD      strong generated password (platform compose)
DOCKER_GID             host docker group gid (build arg; lets the api run as non-root)
SWIM_DEPLOY_TIMEOUT    seconds to wait for container health, default 120
SWIM_MAX_BUILDS        global concurrent builds, default 2
SWIM_DATA_DIR          root for generated artifacts, default /data (the swim-data volume)
NODE_ENV               production
```

`.env` is never committed; `.env.example` lists every key with a comment. Secrets are generated with `openssl rand -base64 32`.

## 6. Coding conventions

1. **ESM + strict TypeScript** everywhere; no default exports for modules, named exports only.
2. **Files stay small.** One route resource per file, one service per domain concern. If a file exceeds ~200 lines, split it.
3. **zod-first:** every request body/query is parsed with a zod schema at the route boundary; types flow from `z.infer`.
4. **Error shape:** throw `new HttpError(status, code, message)`; a single Express error middleware maps it to `{ "error": { code, message, details? } }`. Never leak stack traces.
5. **No premature abstraction:** plain functions, no classes (except where a library requires it), no repository layer, no DI container — the Sequelize models (`db`) and route handlers talk directly.
6. **Child processes:** always `spawn`, stream stdout/stderr line-by-line into the deployment log, and kill on abort/disconnect. Never `exec` with interpolated input.
7. **Formatting:** Prettier defaults, no ESLint bikeshedding — a minimal `eslint.config.js` with `@typescript-eslint` recommended + React hooks + react-refresh is enough.
8. **Idempotency:** anything that writes files or runs docker commands must be safe to re-run (boot reconciliation relies on it).

Next: `04-project-structure.md`.
