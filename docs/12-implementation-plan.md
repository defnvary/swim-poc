# 12 — Implementation Plan

A build order for the implementing agent. Each phase lists the files created (04 §1 names), the tests that must pass (11), and a "done when" checkpoint. Never start a phase before the previous checkpoint is green; never "come back later" to a failing checkpoint.

## 1. Phase map

| # | Phase | Produces | Blocks |
|---|---|---|---|
| 0 | Scaffold | workspaces, db models + init migration, config, health route | everything |
| 1 | Core libs | lib/crypto, lib/jwt, lib/exec, lib/sse + unit tests | 2, 4 |
| 2 | Auth & users | middleware, routes/auth, routes/users, routes/events, services/audit | 3, 5 |
| 3 | Apps & resources | routes/apps, routes/domains, routes/env, routes/deployments, services/nginx, services/certs, services/docker, services/git | 4, 5 |
| 4 | Deploy pipeline | services/deploy-queue, services/deploy, routes/hooks, routes/logs, log SSE | 6 |
| 5 | Dashboard | everything under dashboard/src | 6 (parallel with 4) |
| 6 | Platform packaging | server/Dockerfile, docker-compose.yml, nginx/nginx.conf, static.ts, boot reconciliation, daily timer | 7 |
| 7 | Acceptance | 02 §7 checklist on a clean host | — |

Phases 4 and 5 are independent of each other — build them in either order or interleaved. Both depend on phases 0–3.

## 2. Phase detail & checkpoints

### Phase 0 — Scaffold
Create: root package.json, .gitignore, .dockerignore, .env.example (03 §5), the server and dashboard package.json + tsconfigs, server/src/db/sequelize.ts + db/models.ts + db/migrate.ts + db/migrations/20260101000000-init.ts (05 §1/§7 verbatim), server/src/config.ts, and a minimal index.ts exposing GET /api/health.
Run: npm install, then npm -w server run migrate against a local Postgres (05 §7).
Checkpoint: npm run dev boots api + dashboard; /api/health reports status ok and db ok; Vite serves a placeholder page.

### Phase 1 — Core libs
Create: lib/crypto.ts, lib/jwt.ts, lib/exec.ts, lib/sse.ts exactly per 04 §2.
Tests: the four unit suites in 11 §3 (crypto, jwt, exec, sse).
Checkpoint: npm -w server test green for the unit portion.

### Phase 2 — Auth & users
Create: middleware/auth.ts, middleware/error.ts, middleware/rate-limit.ts, routes/auth.ts (all five endpoints, 06 §3), routes/users.ts (06 §4), services/audit.ts, routes/events.ts (06 §10); wire the middleware order in index.ts (04 §2).
Tests: auth, refresh, users, events suites (11 §4).
Checkpoint: setup, login, refresh rotation with reuse-kill, and the RBAC matrix all hold in the integration suite.

### Phase 3 — Apps, domains, env, deployments
Create: routes/apps.ts (06 §5), routes/domains.ts (06 §8), routes/env.ts (06 §9), routes/deployments.ts (06 §6), plus services/nginx.ts (09 §3–4), services/certs.ts (09 §5–8), services/docker.ts (07 §5, 09 §6), services/git.ts (07 §3).
Tests: apps, domains, env, deployments suites with services mocked (11 §4).
Checkpoint: CRUD and validation behaviors pass; the webhook secret appears in exactly one response (06 §5).

### Phase 4 — Deploy pipeline
Create: services/deploy-queue.ts (07 §2), services/deploy.ts (07 §3–7), routes/hooks.ts (06 §12), routes/logs.ts (06 §7), deployment-log SSE on routes/deployments.ts (06 §6).
Tests: deploy-queue unit suite (11 §3), hooks integration suite (11 §4).
Checkpoint (needs Docker locally): create a real app pointing at a sample repo, push a commit, watch it go live end-to-end — the first full pipeline run on the dev host.

### Phase 5 — Dashboard
Create in this order (each step builds on the last): theme.ts, api/types.ts (mirror of 06 responses), api/client.ts, api/sse.ts, auth/AuthContext.tsx, components/AppShell.tsx, then the pages: SetupPage, LoginPage, AppsPage, NewAppPage, AppDetailPage (tabs: Overview, Deployments, Logs, Environment, Domains, Settings), UsersPage, EventsPage — plus components as each page needs them.
Tests: render smokes + client refresh single-flight (11 §6).
Checkpoint: every primary flow (create app, watch a deploy, edit env, add domain, manage users) is completable from the UI against the dev api.

### Phase 6 — Platform packaging
Create: server/Dockerfile (08 §3 verbatim), docker-compose.yml (08 §2 verbatim), nginx/nginx.conf (09 §2 verbatim), server/src/static.ts (04 §2), boot reconciliation in index.ts (07 §10, all five steps), and the daily timer start (09 §8).
Checkpoint: on a clean Ubuntu 24.04 VM following 13-setup-guide.md, one docker compose up -d --build reaches the HTTPS dashboard; reconciliation logs each step.

### Phase 7 — Acceptance
Execute the 02 §7 checklist top to bottom on that VM. Every failure becomes either a fix or a new automated case (11 §9).
Checkpoint: all boxes ticked.

## 3. Line budget (NFR-6)

The ~2,500-line ceiling (02 §6 NFR-6 — first-party server + dashboard combined, excluding tests and generated files) breaks down as:

| Area | Budget (lines) |
|---|---|
| server libs + middleware | ~350 |
| server routes | ~600 |
| server services | ~700 |
| dashboard (pages, components, api, auth) | ~850 |
| total | ~2,500 |

If an area trends more than ~20 percent over budget, stop and simplify — over-budget almost always means an unplanned abstraction crept in.

## 4. Rules during implementation

1. Build exactly the files in 04 §1 — no extras, no grab-bag util modules.
2. No endpoint, env var, event action, or dependency outside 03, 05, and 06.
3. A failing checkpoint blocks the next phase; fix it now, not later.
4. Commit per phase, message = phase number + name.
5. The docs are the contract: if reality must diverge, update the doc in the same commit.

## 5. Pressure fallbacks (in order)

| If | Then |
|---|---|
| The dashboard runs long | ship the Settings tab last — stop/start stays reachable via API and Overview |
| Pipeline debugging stalls | verify with buildType=dockerfile apps first; node/static generators afterwards |
| Cert flows stall on DNS | finish the run with one manual certbot issue and note it; automate before release — never ship a silent manual step |

Next: 13-setup-guide.md.
