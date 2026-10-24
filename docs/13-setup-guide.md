# 13 — Setup & Operations Guide

Operator runbook: from a clean server to a running platform, then day-2 operations. Everything here is executable exactly as written.

## 1. Prerequisites

| Requirement | Value |
|---|---|
| OS | Ubuntu 24.04 LTS (any modern Linux with Docker works) |
| Hardware | 1 vCPU, 2 GB RAM, 20 GB disk minimum |
| Software | Docker Engine 27+ with the Compose v2 plugin; git |
| Network | ports 80 and 443 reachable from the internet |
| DNS | a domain you control (a subdomain works — SWIM_DOMAIN can be paas.example.com) |

Install Docker from the official apt repository (docs.docker.com → Install Docker Engine → Ubuntu); verify with docker compose version. If ufw is active, run ufw allow 80,443/tcp — note that Docker publishes ports directly, so only nginx binds 80/443 anyway (08 §2).

## 2. DNS records (before install)

| Record | Type | Value |
|---|---|---|
| swim.<SWIM_DOMAIN> | A | server IP |
| *.<SWIM_DOMAIN> | A | server IP (recommended — every app subdomain works with zero per-app DNS) |

## 3. Install

```bash
# 1 — get the code
git clone https://github.com/your-org/swim.git swim && cd swim

# 2 — create .env
cp .env.example .env
openssl rand -base64 32        # -> SWIM_SECRET_KEY
openssl rand -base64 32        # -> SWIM_JWT_SECRET
openssl rand -base64 24        # -> POSTGRES_PASSWORD (also inline into DATABASE_URL)
stat -c %g /var/run/docker.sock   # -> DOCKER_GID
```

Edit .env:

```text
SWIM_DOMAIN=example.com
SWIM_ACME_EMAIL=you@example.com
SWIM_SECRET_KEY=<base64 from step 2>
SWIM_JWT_SECRET=<base64 from step 2>
POSTGRES_PASSWORD=<generated>
DATABASE_URL=postgres://swim:<same password>@swim-db:5432/swim
DOCKER_GID=<gid from step 2>
# optional: SWIM_DEPLOY_TIMEOUT=120, SWIM_MAX_BUILDS=2, SWIM_DATA_DIR=/data (01 §4)
```

```bash
# 3 — the external app network (created once, owned by nobody — 08 §2)
docker network create swim-edge

# 4 — build and start (the only command you will ever need for upgrades too)
docker compose up -d --build
```

## 4. First boot

- docker compose logs -f api shows: migrations applied → swim-edge verified → platform vhost written → platform cert issued (07 §10).
- The dashboard is HTTPS-dark for roughly 30–60 seconds while the certificate issues (09 §7), then https://swim.<SWIM_DOMAIN> serves the setup page.
- Create the first admin immediately (setup exists only while zero users exist — 06 §3), then log in.

If the dashboard does not come up: check DNS (§2), wait a minute, then docker compose restart api — boot reconciliation is idempotent and re-runs every step.

## 5. Your first app

1. **PAT**: GitHub → Settings → Developer settings → Fine-grained personal access tokens → Generate: grant Contents: Read-only to the one repository. Paste it when creating the app (public repos work without a token).
2. **Create the app** in the dashboard (name, owner/repo, branch, port). The confirmation screen shows the **webhook URL and secret exactly once** — save them now.
3. **Wire the webhook**: GitHub repo → Settings → Webhooks → Add webhook: payload URL = the shown URL, content type application/json, secret = the shown secret, events = Just the push event. GitHub's initial ping is answered 200 and ignored (06 §12).
4. Push to the tracked branch → the deployment appears in the dashboard → status turns live → the app answers at https://<slug>.<SWIM_DOMAIN>.

Lost the webhook secret? Rotate it in app Settings — a new URL and secret are issued and the old URL stops working immediately (06 §5).

## 6. Day-2 operations

| Task | How |
|---|---|
| Platform logs | docker compose logs -f api (also nginx, db) |
| App logs | dashboard Logs tab, or docker logs -f swim-app-<slug> |
| Upgrade | git pull && docker compose up -d --build — named volumes, the external network, and all app projects are untouched (08 §8) |
| Restart | docker compose restart — api reconciles on boot; apps never noticed |
| Maintenance window | docker compose stop — apps keep running but are unreachable; choose low traffic (08 §8) |
| Disk pressure | docker images 'swim/*' — old app images can be docker rmi-d; the daily timer already keeps the newest 5 per app (08 §6) |

Backup and restore (NFR-4):

```bash
# backup
docker compose exec db pg_dump -U swim swim > swim-$(date +%F).sql

# restore
docker compose stop api
cat swim-<date>.sql | docker compose exec -T db psql -U swim swim
docker compose start api
```

## 7. Troubleshooting

| Symptom | Look at | Likely fix |
|---|---|---|
| Dashboard unreachable after install | docker compose logs api | DNS A record wrong, or cert still issuing — wait, then docker compose restart api |
| Domain stuck failed cert | dashboard Domains tab + api logs | DNS not pointing at the server yet — fix the record, press Verify (09 §5) |
| Deploy fails at fetching | deployment log | PAT expired or lacks repo access — update it in app Settings (07 §3) |
| Deploy fails at building | deployment log | no Dockerfile / package.json with start / index.html — check build type (07 §4.1) |
| Deploy fails at health check | deployment log + app logs | healthcheckPath does not return 200 — fix the path in app Settings (07 §6) |
| Old container still serving after a failed deploy | expected behavior | failed deploys never touch the running version (01 §8) — redeploy or roll back |
| api cannot talk to docker (permission denied) | docker compose logs api | DOCKER_GID mismatch — re-run stat -c %g /var/run/docker.sock, update .env, rebuild (08 §3) |
| 502 from an app domain | docker logs swim-app-<slug> | app crashed or is stopped — restart via dashboard |
| db down | docker compose logs db | restart: unless-stopped self-heals; api's healthcheck follows |

## 8. Full teardown (destructive)

```bash
# 1 — delete every app in the dashboard/API first: each delete runs the
#     per-app teardown (compose down --rmi local, vhost removal, /data cleanup — 05 §4)
# 2 — remove the platform and its volumes
docker compose down -v
# 3 — remove the shared network
docker network rm swim-edge
# 4 — optional: remove leftover platform-built images
docker rmi $(docker images -q 'swim/*')
```

down -v deletes PostgreSQL data, certificates, cloned sources, and logs — nothing survives but the remote git repos.

This ends the numbered documentation set; README.md indexes it all.
