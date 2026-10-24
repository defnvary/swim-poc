# 11 — Testing Strategy

## 1. Philosophy

- Test the logic **Swim owns**: crypto envelopes, token rotation, queue semantics, template rendering, webhook signature checks, RBAC, zod validation, output redaction, SSE helper behavior.
- Do **not** retest the world: git, docker, nginx, and certbot are exercised by the manual acceptance run (02 §7), not mocked in unit tests — mocking them all is where codebases go to die.
- Coverage is a listed contract, not a percentage goal. The cases in §3 and §4 are what "tested" means for v1; passing them all is the bar.

## 2. Layers at a glance

| Layer | Tool | Speed | Scope |
|---|---|---|---|
| Unit | vitest | ms | pure functions: `lib/crypto`, `lib/jwt`, `lib/exec` redaction, `lib/sse`, vhost + compose templates, slug derivation, `deploy-queue` |
| Integration | vitest + supertest (real Express app, real Postgres, stubbed services) | s | routes, RBAC matrix, zod errors, pagination shape, refresh rotation, webhook router |
| Dashboard | vitest + @testing-library/react (jsdom) | s | render smoke per page, AuthContext, client refresh single-flight |
| Acceptance | manual — 02 §7 checklist + `13-setup-guide.md` | minutes | the full product on a clean host |

## 3. Server unit tests (`server/test/unit/*.test.ts`)

| File | Cases |
|---|---|
| `crypto.test.ts` | encrypt→decrypt roundtrip; tampered `tag` throws; distinct IVs → distinct ciphertext; envelope starts with `v1:` |
| `jwt.test.ts` | sign→verify roundtrip; expired token rejected; wrong-key token rejected; claims carry `sub`/`role`/`username` |
| `exec.test.ts` | a secret on the redact list is rewritten to `[REDACTED]` in every output line (mandatory per 10 §7); exit code captured; `onLine` receives complete lines — using fixed `node -e` snippets |
| `sse.test.ts` (fake timers) | correct headers; heartbeat comment every 15 s; cleanup kills the child and clears the interval on `close` |
| `deploy-queue.test.ts` | two tasks for one app run FIFO; tasks for different apps run concurrently; the semaphore caps concurrency at `SWIM_MAX_BUILDS`; a rejected task does not poison later tasks |
| `slug.test.ts` | derivation from names; `-2`, `-3` uniquification |
| `templates.test.ts` | stage-1 and stage-2 vhosts render byte-exact for given `(host, slug, port, SWIM_DOMAIN)`; compose.yaml renders byte-exact (07 §4.3); generated Dockerfiles match 07 §4.2 |

## 4. Server integration tests (`server/test/api/*.test.ts`)

Harness: the real app assembled exactly as `index.ts` assembles it, minus boot reconciliation; `vi.mock` replaces `services/docker`, `services/git`, `services/certs`, and `services/nginx` so no child process ever spawns; Sequelize talks to the real test database; every suite truncates all tables in `beforeEach`.

| Suite | Cases |
|---|---|
| `auth.test.ts` | setup creates the admin while zero users exist, then 409; `setup.completed` event written; login issues tokens + cookie; wrong password → 401 `invalid_credentials` + `auth.login_failed` event; inactive user → 403 |
| `refresh.test.ts` | refresh rotates (old row revoked, successor shares `familyId`); reusing the rotated token revokes the family → 401 + `auth.token_reuse` event; expired → 401 |
| `users.test.ts` | the RBAC matrix of 06 §2 holds for every route (viewer 403 on writes, member 403 on users, admin 200); no self-demotion or self-deactivation (409); last-active-admin protection (409) |
| `apps.test.ts` | create → 201, and the response is the **only** one containing the webhook secret; duplicate name → slug suffixed; PATCH with `accessToken` updates `tokenLast4`; rotate-hook returns a new secret and the old `hookId` 404s afterwards; app JSON never contains secret fields |
| `deployments.test.ts` | manual deploy → 202 + `queued` row (+ `deploy.queued` event); 409 while a non-terminal deployment exists; malformed `commitSha` → 422 |
| `domains.test.ts` | add → 201 `pending`; duplicate host → 409; deleting the default domain → 409; verify returns the DNS shape with the resolver stubbed |
| `env.test.ts` | viewer gets `masked`, member gets values; PUT is replace-all (removed keys disappear); `applyNow` triggers a deploy (queue mocked to observe) |
| `hooks.test.ts` | valid HMAC (`X-Hub-Signature-256`, computed in-test with `createHmac`) → 202 + deployment row; invalid signature → 401; `ping` → 200 ignored; non-tracked branch → 200 ignored; unknown `hookId` → 404 |
| `events.test.ts` | the actions produced by the suites above are visible in `GET /api/events` (admin only; viewer 403), newest first, paginated |

## 5. Test database & environment

- `server/test/globalSetup.ts` runs once before the suite: asserts `DATABASE_URL` is set, runs the umzug migrations (05 §7), and injects fixed throwaway values for `SWIM_DOMAIN`, `SWIM_ACME_EMAIL`, `SWIM_SECRET_KEY`, and `SWIM_JWT_SECRET` if not already present — so integration tests import `config.ts` unchanged.
- Local run: `docker run -d --name swim-pg -e POSTGRES_USER=swim -e POSTGRES_PASSWORD=swim -e POSTGRES_DB=swim_test -p 5432:5432 postgres:17-alpine`, then `DATABASE_URL=postgres://swim:swim@localhost:5432/swim_test npm -w server test`.
- No testcontainers, no in-memory Postgres substitute — the real engine is one `docker run` away.

## 6. Dashboard tests (`dashboard/src/**/__tests__`)

- **Render smoke** for each page with `api/client` mocked via `vi.mock`: LoginPage shows the form; AppsPage renders app cards from a fixed query result; NewAppPage renders the 3 wizard steps; AppDetailPage renders all tabs.
- **AuthContext**: login stores the access token in memory and exposes `user`; logout clears both; unauthenticated bootstrap redirects.
- **Client refresh single-flight**: `fetch` stubbed with `vi.stubGlobal` so two concurrent requests both get 401 — exactly one refresh call fires, both requests retry with the new token.

No visual regression, no browser e2e — the SPA is thin over the already-tested API.

## 7. What is deliberately not automated

| Excluded | Why |
|---|---|
| docker / nginx / git / certbot interactions | mocking them tests the mocks; the acceptance run tests the real thing |
| webhook → live deployment end-to-end | needs a real GitHub repo and host — that IS the 02 §7 acceptance checklist |
| TLS redirects and ACME paths | curl checks in the runbook (13) |
| Load / performance | NFR-2 targets are validated once during acceptance, not per commit |

The automated suite stays honest and fast (seconds); correctness of the platform glue is proven by the runbook.

## 8. CI (optional, recommended)

```yaml
name: test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: swim
          POSTGRES_PASSWORD: swim
          POSTGRES_DB: swim_test
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npm -w server test
        env:
          DATABASE_URL: postgres://swim:swim@localhost:5432/swim_test
      - run: npm -w dashboard test
```

The globalSetup injects the remaining env (§5), so CI needs only the database URL.

## 9. Acceptance testing (manual, binding)

Every checkbox in 02 §7 is executed on a clean Ubuntu 24.04 host following `13-setup-guide.md` verbatim. A release is done when all boxes are ticked and the automated suite is green. Failures found here become new automated cases in §3/§4 whenever they touch owned logic.

Next: `12-implementation-plan.md`.
