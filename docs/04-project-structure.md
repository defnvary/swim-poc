# 04 — Project Structure

One repository, npm workspaces, two packages (`server`, `dashboard`), plus the platform Compose file and the nginx main config. This is the complete target layout — the implementing agent creates exactly these files and no others (tests may add files under `server/test` and `dashboard/src/**/__tests__`).

## 1. Repository tree

```
swim/
├── docker-compose.yml              # platform stack: nginx, api, db (see 08-docker-strategy.md)
├── .env.example                    # every SWIM_* / DB variable with comments (see 03 §5)
├── .dockerignore                   # node_modules, .env, dashboard/dist, docs, .git
├── .gitignore                      # node_modules, .env, dashboard/dist, server/dist
├── package.json                    # workspaces: ["server", "dashboard"]; root scripts only
├── nginx/
│   └── nginx.conf                  # main config — the ONLY hand-written nginx file
├── docs/                           # this documentation set
├── server/
│   ├── Dockerfile                  # multi-stage; build context = REPO ROOT (needs dashboard/)
│   ├── package.json
│   └── src/
│       ├── index.ts                # bootstrap: config → db → reconcile → listen
│       ├── config.ts               # zod-validated env singleton
│       ├── db/
│       │   ├── sequelize.ts        # Sequelize instance + typed model registry (see 05)
│       │   ├── models.ts           # all model definitions + associations (see 05)
│       │   ├── migrate.ts          # umzug runner (boot, tests, local CLI)
│       │   └── migrations/         # DDL migrations, applied at container start
│       ├── static.ts               # express.static(dashboardDist) + SPA fallback (not /api/*)
│       ├── lib/
│       │   ├── crypto.ts           # AES-256-GCM encrypt/decrypt (env values, PATs, secrets)
│       │   ├── jwt.ts              # jose: sign/verify access tokens, refresh hashing
│       │   ├── exec.ts             # spawn wrapper: line streaming, exit capture, kill
│       │   └── sse.ts              # SSE response helper (headers, keepalive, cleanup)
│       ├── middleware/
│       │   ├── auth.ts             # requireAuth (Bearer JWT), requireRole(...roles)
│       │   ├── error.ts            # HttpError class + final error middleware
│       │   └── rate-limit.ts       # authLimiter / apiLimiter / hookLimiter presets
│       ├── routes/                 # one Express Router per resource; zod schemas inline
│       │   ├── auth.ts             # setup, login, refresh, logout, me
│       │   ├── users.ts            # admin user CRUD
│       │   ├── apps.ts             # app CRUD + rotate-hook + stop/start
│       │   ├── deployments.ts      # list, get, create (manual/rollback), logs
│       │   ├── domains.ts          # add/remove/verify
│       │   ├── env.ts              # PUT replace-all
│       │   ├── logs.ts             # runtime log SSE
│       │   ├── hooks.ts            # POST /hooks/:hookId (public, HMAC)
│       │   └── events.ts           # audit query
│       └── services/
│           ├── deploy-queue.ts     # per-app FIFO + global semaphore (SWIM_MAX_BUILDS)
│           ├── deploy.ts           # pipeline: fetch → dockerfile → compose → build → up → health
│           ├── docker.ts           # thin wrappers: compose build/up/down, logs -f, inspect health
│           ├── git.ts              # clone --depth 1 with token URL, reset --hard for refetch
│           ├── nginx.ts            # renderVhost(), writeVhost(), removeVhost(), reload()
│           ├── certs.ts            # issueCert(), renewTimer (daily), cert paths
│           └── audit.ts            # event() helper writing to Event table
└── dashboard/
    ├── package.json
    ├── index.html
    ├── vite.config.ts              # dev proxy: /api → http://localhost:3000
    └── src/
        ├── main.tsx                # providers: QueryClient, ThemeMode, SnackbarProvider, Router
        ├── App.tsx                 # route table + guards
        ├── theme.ts                # MUI createTheme (light/dark), primary color, typography
        ├── api/
        │   ├── client.ts           # typed fetch wrapper, auto-refresh on 401 (single-flight)
        │   ├── sse.ts              # fetch-based SSE reader with Bearer header
        │   └── types.ts            # API DTO types (mirror of zod outputs)
        ├── auth/AuthContext.tsx    # access token in memory; bootstrap via /auth/me
        ├── components/
        │   ├── AppShell.tsx        # AppBar + Drawer layout, user menu, theme toggle
        │   ├── StatusChip.tsx      # app/deployment status → color/icon
        │   ├── LogViewer.tsx       # SSE terminal-style viewer with pause/follow
        │   ├── DeploymentTimeline.tsx
        │   ├── EnvEditor.tsx        # key/value editor with masked add-row
        │   ├── DomainTable.tsx     # domains + cert status + verify action
        │   ├── SecretField.tsx     # reveal/copy for webhook secret, PAT last4
        │   └── EmptyState.tsx
        └── pages/
            ├── SetupPage.tsx        # first-run admin creation
            ├── LoginPage.tsx
            ├── AppsPage.tsx        # grid of app cards + status
            ├── NewAppPage.tsx      # 3-step wizard (repo → build config → webhook summary)
            ├── AppDetailPage.tsx   # tabs: Overview | Deployments | Logs | Environment | Domains | Settings
            ├── UsersPage.tsx       # admin only
            └── EventsPage.tsx      # admin only
```

## 2. File responsibilities (one line each — nothing more)

| File | Sole responsibility |
|---|---|
| `server/src/index.ts` | Wire middleware + routers in order: helmet → rate limits → `/api` routers → static SPA → 404 → error middleware. Run boot sequence. **No business logic.** |
| `server/src/config.ts` | Parse/validate env once, export typed object. |
| `server/src/static.ts` | Serve built SPA; unknown GETs (non-`/api`) return `index.html`. |
| `db/sequelize.ts` + `db/models.ts` | The one Sequelize instance and the full model registry — the app's only data-access layer (05 §1). |
| `lib/crypto.ts` | `encrypt(plain)` → `v1:<iv>:<tag>:<ct>`, `decrypt(token)` → plain. Used for all secret columns. |
| `lib/jwt.ts` | `signAccessToken(user)`, `verifyAccessToken(token)`; refresh tokens are random 256-bit, stored SHA-256-hashed. |
| `lib/exec.ts` | `run(cmd, args, {onLine})` → `{code, output}` — the only place child processes spawn. |
| `lib/sse.ts` | Set SSE headers, write events, heartbeat every 15s, cleanup on `req.close`. |
| `middleware/auth.ts` | `requireAuth` (verifies Bearer, loads `req.user`), `requireRole('admin')` etc. |
| `middleware/error.ts` | `HttpError(status, code, message, details?)`; maps unknown errors to 500 `{error:{code:"internal"}}`. |
| `routes/*.ts` | Parse input with zod, call the Sequelize models + services, return JSON. No SQL strings outside `db/migrations/`, no docker calls. |
| `services/deploy-queue.ts` | `enqueue(appId, fn)`; per-app serial chain + global semaphore; returns completion promise. |
| `services/deploy.ts` | The pipeline from `07-deploy-pipeline.md` as small steps; updates Deployment/App rows. |
| `services/docker.ts` | `compose(slug, args, onLine)`, `appHealth(slug)`, `appLogs(slug, {tail, since, follow, onLine})`, `runCertbot(args)`, `reloadNginx()`. |
| `services/git.ts` | `fetchSource(app, ref)` → clone-or-reset into `/data/apps/<slug>/src`; returns `{sha, message, author}`. |
| `services/nginx.ts` | Write/remove vhost files under `/data/nginx/`; `reload()` via docker.ts. |
| `services/certs.ts` | `issueCert(host)`, `renewAll()` on a 24h timer, cert path helper. |
| `services/audit.ts` | `event(action, ctx, details?)` — insert row, never throws. |
| `dashboard/src/api/client.ts` | `api(path, init)` with typed helpers per resource; 401 → one shared refresh → retry once → logout. |
| `dashboard/src/api/sse.ts` | `streamSSE(url, onLine, signal)`. |
| `dashboard/src/auth/AuthContext.tsx` | `{ user, login, logout }`; access token in a module variable (memory only). |

## 3. Root `package.json` scripts (the only ones)

```json
{
  "name": "swim",
  "private": true,
  "workspaces": ["server", "dashboard"],
  "scripts": {
    "dev": "concurrently -n api,web \"npm -w server run dev\" \"npm -w dashboard run dev\"",
    "build": "npm -w dashboard run build && npm -w server run build",
    "test": "npm -w server test && npm -w dashboard test",
    "format": "prettier --write ."
  }
}
```

Dev workflow: `npm run dev` starts Express (tsx watch) on :3000 and Vite on :5173 with `/api` proxied — one command, no mocks.

## 4. Build context note (important)

`server/Dockerfile` builds the dashboard too, so the platform image build **must run from the repository root**:

```
docker build -f server/Dockerfile .        # or: docker compose up -d --build (already correct)
```

Stages: (1) `node:24-alpine` → `npm ci -w dashboard && npm -w dashboard run build`; (2) `node:24-alpine` → server deps (`apk add docker-cli docker-cli-compose git`), `npm ci -w server`, tsc build, copy dashboard dist to `/app/dashboard-dist`; `USER node`; `CMD ["sh","-c","node dist/db/migrate.js && node dist/index.js"]`.

## 5. Structural rules

1. No file exceeds ~200 lines; no folder introduces a sub-framework.
2. Only `services/*` touch child processes, the filesystem under `/data`, and nginx. Routes never do.
3. Only `routes/*` and `config.ts` mention zod schemas; only `db/models.ts` defines data shapes.
4. Dashboard talks to the API exclusively through `api/client.ts` + `api/sse.ts` — no component calls `fetch` directly.
5. Generated artifacts (`/data/**`) are never read as config — the database is the source of truth and regeneration is idempotent.
6. Comments in code: only where a non-obvious decision exists (e.g. why `--depth 1`, why constant-time compare). No Javadoc noise.

Next: `05-database-schema.md`.
