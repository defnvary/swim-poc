# Swim

Self-hosted single-server PaaS. The contracts are `docs/01`–`docs/13` — docs win over code.

- `server/` — the api (Express 5, Sequelize, ESM TypeScript)
- `dashboard/` — the web UI
- `docs/13-setup-guide.md` — production install steps

## Local development without root

The api writes all generated artifacts (cloned sources, compose files, vhosts, deployment logs) under `SWIM_DATA_DIR`, which defaults to `/data` (the production `swim-data` volume mount point).

On machines where `/data` is not writable, point it at the project directory instead:

```bash
mkdir -p data/apps data/logs/deployments data/nginx
SWIM_DATA_DIR=./data DATABASE_URL=postgres://swim:swim@localhost:5432/swim npm -w server run dev
```

The resulting `data/` tree mirrors the production layout (`data/apps/<slug>/…`, `data/logs/deployments/<id>.log`, …). It is git-ignored. See `docs/01` §4 and `docs/03` §5.
