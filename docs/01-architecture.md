# 01 — Architecture

Swim is a self-hosted, single-server PaaS. You connect a GitHub repository, push code, and Swim builds a Docker image, deploys it with Docker Compose, routes traffic through Nginx, and issues a Let's Encrypt certificate — all automatically.

This document is the authoritative architecture overview. An AI agent building Swim must follow it exactly and must not introduce additional components (no Kubernetes, no message brokers, no agents, no Docker SDK abstractions).

## 1. Component diagram

```
                          Internet
                             │
                    ┌────────▼────────┐
                    │   swim-nginx    │  ports 80/443 (only published ports)
                    │  edge proxy +   │  TLS termination (Let's Encrypt)
                    │  static vhosts  │
                    └───┬─────────┬───┘
          swim.<domain> │         │  <app-slug>.<domain> / custom domains
        (dashboard + API)│         │
                    ┌────▼────┐ ┌──▼──────────────────────┐
                    │swim-api │ │ swim-app-<slug>          │
                    │Express 5│ │ (deployed app container) │
                    │serves   │ │ one per app, own compose │
                    │SPA +/api│ │ project + healthcheck    │
                    └──┬───┬──┘ └─────────────────────────┘
             ┌─────────┘   └──────────────┐
      ┌──────▼───────┐     ┌──────────────▼────────────────┐
      │   swim-db    │     │ /var/run/docker.sock (mounted)│
      │ PostgreSQL   │     │ api runs `docker compose`,    │
      │17 (Sequelize)│     │ `docker logs`, `docker run`   │
      └──────────────┘     │ certbot ...` via child_process│
                           └───────────────────────────────┘
```

## 2. Components

| Component | What it is | Responsibility |
|---|---|---|
| **swim-nginx** | `nginx:1-alpine` container | TLS termination, HTTP→HTTPS redirect, ACME challenge serving (webroot), proxy `swim.<SWIM_DOMAIN>` → `swim-api:3000`, proxy each app domain → `http://swim-app-<slug>:<port>` |
| **swim-api** | Express 5 + TypeScript container (also serves the built React SPA as static files) | Auth + RBAC, REST API, webhook ingestion, deploy queue, git fetch, compose file generation, nginx vhost generation, certbot orchestration, log streaming |
| **swim-db** | `postgres:17-alpine` container | All platform metadata (users, apps, deployments, domains, env vars, events). Managed via Sequelize |
| **dashboard** | React 19 + MUI v9 SPA (build artifact) | Built in a Docker multi-stage build, served by swim-api's `express.static` — no separate container |
| **deployed apps** | user containers | Each app is its own Docker Compose project (`swim-app-<slug>`) created and controlled by swim-api |
| **certbot** | `certbot/certbot` image, spawned on demand by swim-api (never long-running) | Issues and renews certificates via HTTP-01 webroot into the `swim-certs` volume |

## 3. Networks

| Network | Scope | Members |
|---|---|---|
| `swim-edge` | external bridge network, created once at install | swim-nginx, swim-api, every deployed app container. This is how nginx reaches app containers by DNS name (`swim-app-<slug>`) without any published ports |
| `swim-internal` | platform-only bridge (defined in platform compose file) | swim-api, swim-db. Apps can never reach the database |

**Known trade-off (accepted for v1):** all apps share `swim-edge`, so app containers can address each other. This keeps per-app lifecycle simple (no `docker network connect` bookkeeping). A future hardening path (per-app networks + dynamic nginx attach) is documented in `08-docker-strategy.md` §7.

## 4. Volumes and filesystem layout

| Volume | Mounted at (api) | Mounted at (nginx) | Contents |
|---|---|---|---|
| `swim-data` | `/data` | — | `/data/apps/<slug>/src` (cloned source), `/data/apps/<slug>/compose.yaml` (generated), `/data/apps/<slug>/.env` (generated, mode 600), `/data/logs/deployments/<deploymentId>.log` |
| `swim-conf` | `/data/nginx` | `/etc/nginx/conf.d/apps` (read-only) | Generated per-domain vhost `.conf` files, written only by swim-api |
| `swim-certs` | `/etc/letsencrypt` | `/etc/letsencrypt` (read-only) | Let's Encrypt certs/keys (also mounted rw into spawned certbot containers) |
| `swim-webroot` | `/var/www/certbot` | `/var/www/certbot` | ACME challenge files for HTTP-01 |
| `swim-pgdata` | — | — | PostgreSQL data dir |

## 5. Request routing

**Dashboard / API request** (e.g. `https://swim.example.com/apps`):
1. nginx TLS-terminates, proxies to `http://swim-api:3000`
2. Express serves `/api/*` routes; everything else falls through to `express.static(dashboardDist)` with SPA fallback to `index.html`

**App request** (e.g. `https://myapp.example.com/` or a custom domain):
1. nginx matches the generated vhost for that host (SNI)
2. `proxy_pass http://swim-app-myapp:<app.port>` over `swim-edge`
3. App container has no published host ports — zero port collisions, everything is name-routed

## 6. Deploy sequence (happy path)

```
git push → GitHub sends POST /api/hooks/<hookId> (push event, HMAC-SHA256 signed)
  → api verifies signature, branch filter, repo match
  → creates Deployment row (status=queued), enqueues on per-app FIFO queue
  → worker (status=fetching): git clone --depth 1 (token auth) into /data/apps/<slug>/src
  → (status=building): resolve Dockerfile (repo's own, or generated for Node/static)
  → render compose.yaml + .env from app config
  → docker compose -p swim-app-<slug> build      (output streamed to deployment log)
  → (status=deploying): docker compose -p swim-app-<slug> up -d   (stop-and-recreate)
  → poll docker health status until healthy (timeout, default 120s)
  → (status=live): update app.currentDeploymentId, app.status=live
```

Domains and certificates are managed independently of deploys (see `09-nginx-domains-ssl.md`): adding a domain generates a vhost, issues a cert, and reloads nginx without touching the app container.

## 7. Certificate lifecycle

1. New app / new domain → api writes an HTTP-only vhost (port 80, ACME location) → `nginx -s reload`
2. api spawns `docker run --rm certbot/certbot certonly --webroot ...` with `swim-certs` + `swim-webroot` mounted
3. On success, api writes the full SSL vhost (80→443 redirect + TLS) → reload → `domain.certStatus = issued`
4. A daily timer in swim-api runs `certbot renew` and reloads nginx

Bootstrap: on first boot, swim-api issues the platform cert for `swim.<SWIM_DOMAIN>` the same way before writing the platform SSL vhost. `include` directives use wildcards, so nginx starts cleanly with zero vhosts.

## 8. Failure modes and expected behavior

| Failure | Behavior |
|---|---|
| Build fails | Deployment = `failed` with error + full log; previously running container keeps serving; app.status = `failed` |
| New container unhealthy after `up -d` | Deployment = `failed`; old version already replaced (stop-and-recreate); user can redeploy any past deployment's commit (rollback) via `POST /api/apps/:id/deployments {"commitSha": ...}` |
| api crashes mid-deploy | On boot, any deployment stuck in `fetching|building|deploying` is marked `failed` |
| Webhook arrives during a deploy | Queued; per-app serial execution, FIFO |
| Cert issuance fails | Domain keeps HTTP-only vhost; `certStatus = failed`; retried by user via verify endpoint |
| App container dies | `restart: unless-stopped` restarts it; nginx returns 502 while down |
| db down | api healthcheck fails; docker restarts swim-db; api retries connection (Sequelize pool) |

## 9. Design principles (binding for the implementer)

1. **Less code, fewer moving parts** — reuse the Docker Compose CLI, nginx config files, and the certbot image instead of SDKs, templating engines, or extra services.
2. **One source of truth per artifact** — PostgreSQL for state, generated files under `/data` for runtime artifacts.
3. **Idempotent reconciliation** — on boot, swim-api regenerates all vhosts and re-checks certs from the database.
4. **No hidden magic** — every generated file carries a `# generated by Swim — do not edit` header.
5. **Single server** — no multi-server, agent, or scheduling features in v1.

Next: `02-requirements.md`.
