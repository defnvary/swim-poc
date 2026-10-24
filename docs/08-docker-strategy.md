# 08 — Docker Strategy

Two distinct Docker layers, deliberately kept apart:

| Layer | Compose project | Defined by | Controlled by |
|---|---|---|---|
| Platform | `swim` | `docker-compose.yml` (repo root) | Operator, via `docker compose` |
| Deployed apps | `swim-app-<slug>` (one per app) | `/data/apps/<slug>/compose.yaml` (generated) | swim-api, via `docker compose` over the mounted socket |

The api container is a **client** of the host Docker engine, not a host of nested containers: `/var/run/docker.sock` is mounted in, and the `docker` CLI (installed via apk) talks to the same engine the platform itself runs on. App containers are therefore siblings of swim-api, addressable by DNS name on `swim-edge`. No docker-in-docker, ever.

## 2. Platform stack (`docker-compose.yml` — complete)

```yaml
name: swim

services:
  nginx:
    image: nginx:1-alpine
    container_name: swim-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - swim-conf:/etc/nginx/conf.d/apps:ro
      - swim-certs:/etc/letsencrypt:ro
      - swim-webroot:/var/www/certbot
    networks: [swim-edge]
    depends_on:
      api:
        condition: service_healthy

  api:
    build:
      context: .
      dockerfile: server/Dockerfile
      args:
        DOCKER_GID: ${DOCKER_GID:-999}
    container_name: swim-api
    restart: unless-stopped
    env_file: .env
    environment:
      NODE_ENV: production
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - swim-data:/data
      - swim-conf:/data/nginx
      - swim-certs:/etc/letsencrypt
      - swim-webroot:/var/www/certbot
    networks: [swim-edge, swim-internal]
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s

  db:
    image: postgres:17-alpine
    container_name: swim-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: swim
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: swim
    volumes:
      - swim-pgdata:/var/lib/postgresql/data
    networks: [swim-internal]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U swim -d swim"]
      interval: 10s
      timeout: 5s
      retries: 5

networks:
  swim-edge:
    name: swim-edge
    external: true
  swim-internal:

volumes:
  swim-data:
  swim-conf:
  swim-certs:
  swim-webroot:
  swim-pgdata:
```

Decisions:

- **`swim-edge` is `external`** — created once at install (`docker network create swim-edge`, see `13-setup-guide.md`) and owned by nobody. `docker compose down` on the platform can therefore never delete connectivity for running apps. The api re-asserts the network's existence on boot (07 §10) as a self-healing backstop.
- **Network membership matches 01 §3 exactly**: nginx on `swim-edge` only (it reaches both api and app containers there); api on both; db on `swim-internal` only. Apps join only `swim-edge`, so they can never address `swim-db`.
- **Only nginx publishes ports** (80/443). api and db are name-routed; apps publish nothing (07 §4.3). Zero port collisions by construction.
- **Healthcheck ordering**: db healthy → api starts (and runs migrations); api healthy → nginx starts. With `restart: unless-stopped`, boot order is deterministic and self-healing.
- **nginx mounts `swim-conf` read-only** — the api writes vhosts through its own mount (`/data/nginx`), nginx just reads them; a compromised nginx cannot rewrite routing. Same for `swim-certs`: nginx's master process (root) reads key material; the api's non-root user can check existence but never read keys.
- `swim-certs` and `swim-webroot` are rw in the api **only** so it can spawn certbot containers that need write access (09).
- `name: swim` pins the project name so volume names (`swim_swim-data`, …) are stable regardless of the checkout directory name.

## 3. `server/Dockerfile` (complete)

```dockerfile
# syntax=docker/dockerfile:1

# ---- stage 1: build the dashboard ----
FROM node:24-alpine AS dashboard
WORKDIR /build
COPY package.json package-lock.json ./
COPY dashboard/package.json dashboard/
RUN npm ci -w dashboard
COPY dashboard/ dashboard/
RUN npm -w dashboard run build

# ---- stage 2: build the server ----
FROM node:24-alpine AS server
WORKDIR /app
RUN apk add --no-cache docker-cli docker-cli-compose git
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci -w server
COPY server/ server/
RUN npm -w server run build
COPY --from=dashboard /build/dashboard/dist /app/dashboard-dist

# non-root, but able to use the host docker group
ARG DOCKER_GID=999
RUN addgroup -g ${DOCKER_GID} dockersock && addgroup node dockersock && mkdir -p /data/apps /data/logs/deployments /data/nginx /var/www/certbot && chown -R node:node /data /var/www/certbot

USER node
WORKDIR /app/server
EXPOSE 3000
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
```

Decisions:

- `docker-cli` + `docker-cli-compose` + `git` come from Alpine repos — the api shells out to exactly the tools an operator would type. No Docker SDK (03 §2).
- `DOCKER_GID` (from `.env`, default 999) puts `node` into a group matching the host docker socket's GID, so the api never runs as root. The value comes from `stat -c %g /var/run/docker.sock` on the host (13). If the GID collides with an existing group, `addgroup` fails loudly at build time — fix `.env` and rebuild.
- Named volumes initialize ownership from the image, so `/data` (and its subdirs) are pre-created and chowned — the node user can clone repos and write logs on first boot without an entrypoint script.
- Build context is the repo root (04 §4). Lockfiles are copied before sources so the `npm ci` layers survive source-only edits.
- Migrations run at **container start**, not image build — the image stays environment-agnostic; the same image runs on any host against its own DB.
- Stage 1 produces `dashboard-dist` inside the server image; `static.ts` serves it and the SPA fallback (04 §2).

## 4. The docker socket (accepted risk, mitigated)

Mounting `/var/run/docker.sock` is root-equivalent on the host — anyone who can talk to it can mount anything. Swim's mitigations:

1. api runs as the unprivileged `node` user; socket access is granted only via the docker group GID.
2. Only `services/*` spawn processes at all (04 §5), and only with fixed, non-interpolated argument arrays (03 §6 rule 6).
3. All secrets stay encrypted at rest; deploy logs redact tokens (07 §3).

What is **not** done (documented trade-offs): no rootless-Docker requirement, no filtering socket proxy. If a stronger posture is needed, run the host with rootless Docker or put a filtering proxy in front of the socket — Swim is agnostic because it only ever invokes `docker compose`, `docker logs`, `docker inspect`, `docker run` (certbot), `docker network`, `docker exec` (nginx reload), and `docker images/rmi` (pruning).

## 5. Per-app projects (convention recap)

| Artifact | Value | Set by |
|---|---|---|
| Compose project | `swim-app-<slug>` | `-p` flag (07 §5) |
| Container name | `swim-app-<slug>` | compose.yaml (07 §4.3) — the DNS name vhosts proxy to |
| Image | `swim/<slug>:<sha8>` | compose.yaml `build` + `image` |
| Network | `swim-edge` (external) | compose.yaml |
| Project dir | `/data/apps/<slug>` | api-managed |

The `swim/` image namespace makes platform-built images trivially identifiable for pruning and operator inspection.

## 6. Disk & image management (daily timer, `services/certs.ts`)

- Per app: keep the newest 5 images (`docker images swim/<slug>` → delete all but the 5 newest by creation date, `docker rmi`, ignore errors for tags still in use).
- Per app: keep the newest 50 deployment log files (05 §6).
- Events older than 180 days are deleted (05 §6).
- **No global `docker system prune`** — too blunt; it would destroy unrelated host images. Disk-pressure troubleshooting is manual and documented in `13-setup-guide.md`.

## 7. Hardening path — per-app networks (explicitly not in v1)

The accepted v1 trade-off (01 §3): all apps share `swim-edge`, so app containers can address each other. The isolation path, if ever needed:

1. Each app gets its own `swim-net-<slug>` instead of joining `swim-edge`.
2. swim-nginx attaches dynamically: `docker network connect swim-net-<slug> swim-nginx` after `up -d`; `docker network disconnect` on teardown.
3. vhosts keep using the container name (DNS resolution is per-network).
4. Teardown order matters: disconnect nginx before removing the network.

Cost: connection bookkeeping in deploy/teardown, a new failure mode (nginx attach racing the reload), and per-network cleanup on app delete — roughly +60 lines and more states to reconcile. Deferred until there's a real requirement.

## 8. Upgrade & lifecycle operations

| Action | Command | Notes |
|---|---|---|
| Upgrade platform | `git pull && docker compose up -d --build` | Named volumes, the external network, and all app projects are untouched |
| Restart platform | `docker compose restart` | api reconciles on boot (07 §10); apps never noticed |
| Stop platform (maintenance) | `docker compose stop` | Apps keep running but are unreachable — nginx is the only edge; choose a low-traffic window |
| Full teardown (destructive) | stop every app project first (`docker compose -p swim-app-<slug> down`), then `docker compose down -v` | Removes Postgres data and all Swim state; runbook in `13-setup-guide.md` |

Next: `09-nginx-domains-ssl.md`.
