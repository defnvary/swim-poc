# 06 — API Specification

REST over JSON, all under `/api`, served by the same Express app that serves the dashboard (same origin — no CORS). This is the complete, closed contract: implement every endpoint, add none beyond it.

## 1. Conventions

| Topic | Rule |
|---|---|
| Auth | `Authorization: Bearer <accessToken>` (HS256 JWT, 15 min TTL, claims: `sub` (userId), `role`, `username`) |
| Refresh cookie | `swim_refresh`, httpOnly, `Secure`, `SameSite=Strict`, `Path=/api/auth`, `Max-Age=7d` |
| Body | JSON only; unknown fields rejected (zod `.strict()`) |
| Success codes | 200 read, 201 created, 202 accepted (async work started), 204 no content (delete/logout) |
| Error codes | 400 malformed JSON, 401 unauthenticated, 403 wrong role / inactive user, 404 not found, 409 conflict (duplicate slug/host/username, setup already done), 422 validation, 429 rate limited, 500 internal |
| Error shape | `{ "error": { "code": "<machine_code>", "message": "<human>", "details"?: {...} } }` — zod issues go in `details.issues` |
| Pagination | `?page=1&limit=20` (limit max 100) → `{ "data": [...], "meta": { "page": 1, "limit": 20, "total": 57 } }` |
| Dates | ISO 8601 UTC strings |
| IDs | UUIDs |

Machine error codes: `invalid_credentials`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `validation_failed`, `rate_limited`, `internal`, `bad_signature`, `hook_not_found`.

## 2. RBAC matrix (enforced server-side on every route)

| Capability | viewer | member | admin |
|---|---|---|---|
| Read apps/deployments/domains, stream logs | ✔ | ✔ | ✔ |
| Read env (values masked) | ✔ | ✔ (plaintext) | ✔ (plaintext) |
| Create/update app, rotate hook, deploy, stop/start | ✖ | ✔ | ✔ |
| Write env, add/remove domains | ✖ | ✔ | ✔ |
| Delete app | ✖ | ✔ | ✔ |
| Users CRUD, events list | ✖ | ✖ | ✔ |

## 3. Auth

### POST /api/auth/setup — public **only while zero users exist**
```json
{ "username": "admin", "password": "at-least-10-chars" }
```
→ 201 `{ "accessToken": "…", "user": {…} }` + refresh cookie. After the first user exists → 409. Records `setup.completed`.

### POST /api/auth/login
`{ "username", "password" }` → 200 `{ "accessToken", "user" }` + refresh cookie; 401 `invalid_credentials` otherwise. `user` = `{ id, username, role, createdAt }`.

### POST /api/auth/refresh
Reads `swim_refresh` cookie → 200 `{ "accessToken", "user" }` (rotates token per `05` §3). Invalid/reused → 401 (cookie cleared).

### POST /api/auth/logout — auth
→ 204, revokes the presented refresh token, clears cookie.

### GET /api/auth/me — auth
→ 200 `{ "user": { id, username, role, createdAt } }`.

## 4. Users (admin)

| Method & path | Body | Result |
|---|---|---|
| GET `/api/users?page&limit` | — | 200 paginated `{ id, username, role, active, createdAt }` |
| POST `/api/users` | `{ username, password, role }` | 201 user |
| PATCH `/api/users/:id` | `{ role?, active?, password? }` (min one field) | 200 user |
| DELETE `/api/users/:id` | — | 204 — deactivates + revokes tokens (soft delete, see `05` §4) |

Rules: password ≥ 10 chars; cannot deactivate or demote your own account (409); last active admin cannot be demoted or deactivated (409).

## 5. Apps

**App JSON** (all app responses):
```json
{
  "id": "uuid", "name": "My App", "slug": "my-app",
  "repoOwner": "acme", "repoName": "my-app", "branch": "main",
  "port": 3000, "healthcheckPath": "/", "buildType": "auto", "autoDeploy": true,
  "status": "live",
  "hasToken": true, "tokenLast4": "1f9a",
  "domains": [{ "id": "uuid", "host": "my-app.example.com", "certStatus": "issued" }],
  "currentDeployment": { "id": "uuid", "commitSha": "…40…", "commitMessage": "…", "author": "…", "status": "live", "createdAt": "…" },
  "createdAt": "…"
}
```
`webhookSecret` and the full PAT are **never** included here.

| Method & path | Auth | Body | Result |
|---|---|---|---|
| GET `/api/apps?page&limit` | any | — | 200 paginated apps (summary: no `currentDeployment` object, only `currentDeploymentId`) |
| POST `/api/apps` | member+ | see below | 201 — **only response that includes** `webhook: { "url": "https://swim.<SWIM_DOMAIN>/api/hooks/<hookId>", "secret": "<hex40>" }` |
| GET `/api/apps/:id` | any | — | 200 full app JSON |
| PATCH `/api/apps/:id` | member+ | `{ name?, repoOwner?, repoName?, branch?, port?, healthcheckPath?, buildType?, autoDeploy?, accessToken? }` | 200 — `accessToken` replaces the stored PAT |
| DELETE `/api/apps/:id` | member+ | — | 204 after full teardown (`05` §4) |
| POST `/api/apps/:id/rotate-hook` | member+ | — | 200 `{ webhook: { url, secret } }` — new `hookId` + secret; old URL stops working |
| POST `/api/apps/:id/stop` | member+ | — | 200 `{ status: "stopped" }` — `compose down`, vhosts stay |
| POST `/api/apps/:id/start` | member+ | — | 200 `{ status: "live" }` — re-`up` from current deployment's image; 409 if never deployed |

POST body (zod): `{ name: string 1–50, repoOwner: /^[A-Za-z0-9-]+$/, repoName: /^[A-Za-z0-9._-]+$/, branch?: string (default "main"), port?: int 1–65535 (default 3000), healthcheckPath?: string starting with "/" (default "/"), buildType?: "auto"|"dockerfile"|"node"|"static" (default "auto"), autoDeploy?: bool (default true), accessToken?: string (required unless repo is public) }`.

## 6. Deployments

**Deployment JSON**: `{ id, appId, commitSha, commitMessage, author, branch, status, trigger: "webhook"|"manual", triggeredBy: "username"|null, error, startedAt, finishedAt, createdAt }`

| Method & path | Auth | Result |
|---|---|---|
| GET `/api/apps/:id/deployments?page&limit` | any | 200 paginated, newest first |
| POST `/api/apps/:id/deployments` | member+ | Body `{ commitSha?: /^[0-9a-f]{40}$/ }` (default: branch HEAD) → **202** `{ "deployment": {…} }`; 409 if a deploy is already running for the app |
| GET `/api/deployments/:id` | any | 200 deployment JSON |
| GET `/api/deployments/:id/logs?tail=200&follow=1` | any | SSE (below); `follow` only honored while status is `queued|fetching|building|deploying` |

## 7. Logs (runtime)

GET `/api/apps/:id/logs?tail=200&since=<ISO>&follow=1` — member+ (viewers too, per RBAC §2). Streams `docker logs` for `swim-app-<slug>`; `follow=1` keeps the stream open. 409 with `{"error":{"code":"conflict","message":"app is not running"}}` when there is no container.

## 8. Domains

| Method & path | Auth | Body | Result |
|---|---|---|---|
| GET `/api/apps/:id/domains` | any | — | 200 `[{ id, host, certStatus, certIssuedAt, createdAt }]` |
| POST `/api/apps/:id/domains` | member+ | `{ "host": "myapp.com" }` | 201 `{ id, host, certStatus: "pending" }` — vhost + cert issuance kick off in the background (§ below); 409 if host exists anywhere; 422 for bad hostname (`/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/`, must not equal the platform host) |
| DELETE `/api/domains/:id` | member+ | — | 204 after vhost removal + reload |
| POST `/api/domains/:id/verify` | member+ | — | 200 `{ host, certStatus, dns: { "resolved": true, "pointsToServer": true } }` — re-checks DNS A record against the server IP and retries a failed cert |

The default `<slug>.<SWIM_DOMAIN>` domain is created with the app and **cannot be deleted** (409) while the app exists.

## 9. Env vars

| Method & path | Auth | Result |
|---|---|---|
| GET `/api/apps/:id/env` | any | viewer: `[{ "key": "API_KEY", "masked": true }]`; member/admin: `[{ "key": "API_KEY", "value": "secret" }]` |
| PUT `/api/apps/:id/env` | member+ | Body `{ "vars": [{ "key": "^[A-Z_][A-Z0-9_]*$", "value": "string ≤ 10 KB" }], "applyNow": false }` — **replace-all** → 200 `{ "applied": 12, "redeployTriggered": false }`. `applyNow: true` triggers a manual deployment of the current commit and returns `redeployTriggered: true` |

## 10. Events (admin)

GET `/api/events?page&limit&action=<filter>` → 200 paginated `[{ id, action, user: { username } | null, targetType, targetId, details, createdAt }]`, newest first.

## 11. Health

GET `/api/health` — public, no auth, not rate limited beyond the global limiter: `{ "status": "ok", "db": "ok", "version": "1.0.0" }` (500 shape with `db: "down"` if the DB check fails). Used by the Docker healthcheck on swim-api.

## 12. GitHub webhook (public)

POST `/api/hooks/:hookId`

| Situation | Response |
|---|---|
| Valid signature, push, matching repo + branch, autoDeploy on | **202** `{ "deploymentId": "uuid" }` — enqueue and return immediately (GitHub needs fast responses; never block on the deploy) |
| `ping` event | 200 `{ "ignored": "ping" }` |
| Push to a non-tracked branch or other event types | 200 `{ "ignored": "branch" }` / `{ "ignored": "event" }` |
| autoDeploy off | 200 `{ "ignored": "auto_deploy_disabled" }` |
| Missing/invalid `X-Hub-Signature-256` (compare with `crypto.timingSafeEqual` against HMAC-SHA256 of the raw body) | 401 `bad_signature` |
| Unknown `hookId` | 404 `hook_not_found` |

Signature verification happens on the **raw** request body (`express.raw({ type: 'application/json' })` mounted for this router only) before any parsing. Rate limit: 60 req/min per `hookId`.

## 13. SSE event format (both log streams)

Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no` (nginx). Payloads are JSON lines:

```
 event: log
 data: {"line":"Step 4/12 : RUN npm ci"}

 event: status
 data: {"status":"building"}

 event: done
 data: {"status":"live"}
```

`event: log` lines are appended verbatim to `/data/logs/deployments/<id>.log` for deployment streams. A `done` event closes the stream. Heartbeat comment (`: ping`) every 15 s. On client disconnect, kill the underlying child process (`docker logs -f`) — never orphan it.

## 14. Rate limits (express-rate-limit, per § presets)

| Limiter | Applies to | Rule |
|---|---|---|
| authLimiter | setup, login, refresh | 10/min per IP |
| apiLimiter | all `/api/*` except hooks/health | 300/min per user (fall back to IP when unauthenticated) |
| hookLimiter | `/api/hooks/*` | 60/min per hookId |

429 responses use the standard error shape with `rate_limited` and `Retry-After`.

## 15. Example session

```bash
# setup (fresh install)
curl -X POST https://swim.example.com/api/auth/setup -H 'content-type: application/json' \
  -d '{"username":"admin","password":"correct-horse-battery"}'

# login (save cookies for refresh)
curl -c jar.txt -X POST https://swim.example.com/api/auth/login -H 'content-type: application/json' \
  -d '{"username":"admin","password":"correct-horse-battery"}'

# create an app (note the one-time webhook secret)
TOKEN=eyJ...
curl -X POST https://swim.example.com/api/apps -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"Demo","repoOwner":"acme","repoName":"demo","accessToken":"github_pat_…"}'

# manual deploy of a past commit (rollback)
curl -X POST https://swim.example.com/api/apps/$APP_ID/deployments \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"commitSha":"a1b2c3d4e5f6…40 chars…"}'
```

Next: `07-deploy-pipeline.md`.
