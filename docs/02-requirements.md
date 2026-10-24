# 02 — Requirements

This document defines what Swim must do (functional), how well it must behave (non-functional), and the acceptance criteria the implementation is judged against. Terminology here is binding for all other docs.

## 1. Goals

1. Deploy GitHub-hosted apps to a single server via `git push`, with zero manual server interaction after initial install.
2. Automatic builds (Docker) and deploys (Docker Compose) with health verification.
3. Automatic routing and TLS for every app: default `<slug>.<SWIM_DOMAIN>` subdomain plus user-attached custom domains.
4. A web dashboard for managing apps, deployments, logs, env vars, domains, and users.

## 2. Non-goals (v1)

- Multi-server orchestration, autoscaling, or scheduling
- CI features (tests, linting) inside the deploy pipeline — build + healthcheck only
- Buildpacks beyond the Node.js and static-site fallbacks defined in `07-deploy-pipeline.md`
- Git hosting — source of truth is always GitHub
- Zero-downtime deploys (blue-green) — v1 uses stop-and-recreate
- Per-app resource metering / billing

## 3. User roles

| Role | Capability |
|---|---|
| **admin** | Everything: manage users, view audit events, manage all apps |
| **member** | Create apps and manage apps they can see (v1: all apps), trigger deploys, manage env vars and domains |
| **viewer** | Read-only: view apps, deployments, logs, domains (env values masked) |

## 4. User stories → functional requirements

| Story | Requirement |
|---|---|
| US-1: As a first-time operator, I install Swim once and create the first admin | FR-1 |
| US-2: As an admin, I invite/manage users and assign roles | FR-2 |
| US-3: As a member, I create an app from a GitHub repo | FR-3 |
| US-4: As a developer, I push to GitHub and the app rebuilds and redeploys automatically | FR-4, FR-5 |
| US-5: As a member, I trigger or re-run a deployment manually, including rollback to a past commit | FR-6 |
| US-6: As a member, I watch a deployment's build output live | FR-7 |
| US-7: As a member, I stream the app's runtime logs | FR-8 |
| US-8: As a member, I set environment variables without redeploying secrets by hand | FR-9 |
| US-9: As a member, I attach a custom domain with automatic HTTPS | FR-10 |
| US-10: As a user, my app is reachable at `<slug>.<base-domain>` with HTTPS | FR-10 |
| US-11: As a member, I stop and start an app | FR-11 |
| US-12: As an admin, I see an audit trail of important actions | FR-12 |
| US-13: As an operator, I get alerted visibly when a deploy or cert fails | FR-5, FR-13 |

## 5. Functional requirements

### Authentication & users (FR-1, FR-2)
- **FR-1** First-run setup: while zero users exist, `POST /api/auth/setup` creates the first `admin`. Afterwards it returns 409. Login via username + password; JWT access token (15 min) + rotating refresh token (7 days, httpOnly cookie, reuse detection revokes the family).
- **FR-2** Admin CRUD on users: create, change role, deactivate (soft delete — never delete rows referenced by deployments), reset password. Roles: `admin | member | viewer`.

### Apps (FR-3, FR-11)
- **FR-3** Create app: name, GitHub `owner/repo`, branch (default `main`), internal port (default `3000`), healthcheck path (default `/`), build type (`auto | dockerfile | node | static`), auto-deploy toggle (default on). App creation provisions: unique slug, default domain `<slug>.<SWIM_DOMAIN>`, webhook URL + secret, empty env set, status `created`. Requires a GitHub access token (fine-grained PAT, Contents: Read-only) attached to the app.
- **FR-11** Stop (`docker compose down`, status `stopped`, domains keep vhosts but return 502) and start (re-run last deployment's image, status `live`).

### Deploy pipeline (FR-4 – FR-7)
- **FR-4** Webhook: `POST /api/hooks/:hookId` accepts GitHub push events; verifies `X-Hub-Signature-256` HMAC-SHA256 in constant time; filters to the configured branch and repo; responds `202` and enqueues a deployment. GitHub `ping` events answer `200` with no action.
- **FR-5** Deployment lifecycle: `queued → fetching → building → deploying → live | failed`, executed on a per-app serial FIFO queue (global concurrency cap: 2 builds). Failure captures exit code/stderr tail and preserves the last good deployment record. Automatic on push when auto-deploy is on.
- **FR-6** Manual deploy: `POST /api/apps/:id/deployments` with optional `commitSha` (defaults to branch HEAD). Redeploying a past deployment's SHA is the rollback mechanism.
- **FR-7** Deployment logs: every step's stdout/stderr appended to a per-deployment log, retrievable with `?tail=N` and streamed live (SSE) while the deployment is active.

### Runtime (FR-8, FR-9)
- **FR-8** Runtime logs streamed (SSE) from `docker logs` with `tail` and `since` support; stream ends on client disconnect without leaking the child process.
- **FR-9** Env vars: replace-all semantics (`PUT /api/apps/:id/env`), encrypted at rest, written to the app's generated `.env` at deploy time. Values visible to admin/member; masked for viewer. Deploy applies them; a `applyNow` flag triggers redeploy.

### Domains & TLS (FR-10)
- **FR-10** Every app gets `<slug>.<SWIM_DOMAIN>`. Custom domains can be attached (validated hostname syntax, uniqueness). Adding a domain generates an nginx vhost and issues a Let's Encrypt certificate via HTTP-01 automatically; `certStatus: pending → issued | failed`. Deletion removes the vhost and reloads nginx. Daily automatic renewal with nginx reload. All HTTP traffic redirects to HTTPS except ACME paths.

### Audit (FR-12)
- **FR-12** Events recorded for: login, user created/updated, app created/updated/deleted, deploy triggered (webhook/manual + user), domain added/removed, env updated, stop/start. Queryable by admins (`GET /api/events`) with pagination.

### Health (FR-13)
- **FR-13** `GET /api/health` returns process and DB status for monitoring. Failed deploys and failed certs surface in the dashboard with error details.

## 6. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 Security | Secrets (PATs, webhook secrets, env values) encrypted at rest (AES-256-GCM); passwords hashed with argon2id; RBAC enforced server-side on every route; rate limiting on auth and webhook endpoints; no CORS (same-origin deployment) |
| NFR-2 Performance | Typical deploy (clone + build + healthcheck) under 3 minutes for a small Node app; dashboard interactions < 200 ms p95 server-side; API supports 50 concurrent dashboard users |
| NFR-3 Reliability | All platform containers `restart: unless-stopped`; apps restart automatically; stuck deployments reconciled on api boot; renewal self-heals |
| NFR-4 Recoverability | PostgreSQL dump documented in the ops runbook; all generated artifacts reproducible from DB state |
| NFR-5 Operability | Whole platform is one `docker compose up -d`; upgrade = `git pull && docker compose up -d --build`; troubleshooting table in setup guide |
| NFR-6 Maintainability | TypeScript strict mode; small dependency set (see `03-tech-stack.md`); ≤ ~2,500 lines of first-party server + dashboard code combined (excluding generated files and tests); every requirement here traceable in the acceptance list below |
| NFR-7 Usability | All primary flows (create app → first deploy → custom domain) completable from the dashboard without CLI; responsive down to 375 px |

## 7. Acceptance criteria (definition of done)

The implementing agent is done when every box below is demonstrably true:

- [ ] Fresh install on a clean Ubuntu 24.04 + Docker host, following `13-setup-guide.md` verbatim, reaches the HTTPS dashboard after one `docker compose up -d --build`.
- [ ] First-run setup creates the admin; login, refresh, and logout work; refresh-token reuse revokes the session.
- [ ] Admin can create a `member` and a `viewer`; the viewer gets 403 on every mutating route.
- [ ] Creating an app with a sample Node repo (with Dockerfile) and pushing a commit to the tracked branch produces: webhook 202 → deployment row → `live` status → app reachable at `https://<slug>.<SWIM_DOMAIN>` with a valid certificate.
- [ ] Pushing to a non-tracked branch produces no deployment.
- [ ] A webhook with an invalid signature is rejected with 401.
- [ ] An app without a Dockerfile but with a Node `package.json` deploys via the generated Node Dockerfile.
- [ ] Build failure (e.g. broken Dockerfile) marks the deployment `failed` with logs, keeps the previous version serving, and shows the error in the dashboard.
- [ ] Redeploying a past deployment's commit SHA succeeds (rollback path).
- [ ] Env var added in the dashboard is present in the running container after the next deploy (`docker exec ... env` check).
- [ ] Viewer sees masked env values; member sees plaintext.
- [ ] Custom domain with an A record to the server issues a cert and serves the app over HTTPS within ~2 minutes of being added.
- [ ] HTTP requests redirect to HTTPS; `/.well-known/acme-challenge/` still works over HTTP.
- [ ] Runtime and deployment logs stream live in the dashboard (SSE) and stop cleanly on disconnect.
- [ ] Stop/start toggles the app between `stopped` and `live`.
- [ ] `GET /api/events` shows entries for the actions performed during testing.
- [ ] No app container publishes host ports; only swim-nginx binds 80/443.
- [ ] Database migrations apply automatically on container start; restart resilience verified (`docker compose restart` recovers).

Next: `03-tech-stack.md`.
