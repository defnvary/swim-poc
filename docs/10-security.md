# 10 — Security

This document consolidates the security model. It introduces **no new mechanisms** — it binds together the pieces specified in `03`, `05`, `06`, `07`, `08`, and `09`, and records the accepted risks explicitly so nothing is silently assumed.

## 1. Threat model

| Asset | Threat | Primary defense |
|---|---|---|
| User accounts | credential stuffing, brute force | argon2id hashing + authLimiter (10/min/IP) + `auth.login_failed` events |
| Sessions | token theft, replay | 15-min JWTs + rotating refresh tokens with family revocation (05 §3) |
| GitHub PATs, webhook secrets, env values | DB dump leak, log leakage | AES-256-GCM at rest + `[REDACTED]` redaction in subprocess output |
| Deploy pipeline | command injection, malicious repo content | fixed argument arrays (no shell), zod-validated inputs, non-root api |
| Webhook endpoint | forged payloads, flooding | HMAC-SHA256 timing-safe verify + 60/min per hookId |
| Host via docker.sock | root-equivalent socket abuse | non-root `node` user + docker-group GID; residual risk accepted (08 §4) |
| Platform DB | network exposure | no published ports, `swim-internal` only (08 §2); apps cannot address it |
| TLS keys | volume theft | nginx mounts certs read-only; the api user can check existence but never read key material (08 §2) |

Trust assumptions: operators holding accounts are trusted; app source code is **semi-trusted** (it may attack its own container and neighbors on `swim-edge` — accepted, 01 §3, 08 §7); GitHub push payloads are **untrusted** until signature-verified.

## 2. Authentication

- **Passwords**: argon2id (03 §2), minimum 10 characters (06 §4). Never logged; no email-based reset — admins reset passwords via `PATCH /api/users/:id`.
- **Access tokens**: HS256 JWT, 15 min TTL, claims `sub`/`role`/`username` (06 §1). Sent as `Bearer`; held in dashboard memory only, never localStorage (04 §2 `AuthContext`).
- **Refresh tokens**: 256-bit random, stored SHA-256-hashed, in an httpOnly + Secure + SameSite=Strict cookie scoped to `Path=/api/auth`, 7-day expiry. Rotated on every refresh; presenting a rotated or revoked token kills the entire family (05 §3) and is evented as `auth.token_reuse`.
- **Invalidation paths**: logout revokes the presented token; deactivation or password reset revokes **all** of the user's tokens (05 §4) — and deactivation takes effect on the next request, not at token expiry, because `requireAuth` checks `active` from the DB.
- **Setup**: `POST /api/auth/setup` exists only while zero users exist (06 §3). First-come is admin; operators complete setup immediately after install (`13-setup-guide.md`).

## 3. Authorization

- The RBAC matrix (06 §2) is enforced in middleware (`requireAuth`, `requireRole`) on every route — no route trusts the client by omission.
- Object-level lookups return 404 (not 403) for missing ids; role failures return 403 with the standard error shape (06 §1).
- Self-protection rules: no self-deactivation or self-demotion; the last active admin cannot be demoted or deactivated (06 §4).
- v1 has no per-app ACLs — all members see and manage all apps (02 §3). Documented, not accidental.

## 4. Secrets at rest

Envelope `v1:<iv>:<tag>:<ct>` (base64 parts), AES-256-GCM, key = `SWIM_SECRET_KEY` (32 bytes, base64). Implemented once in `lib/crypto.ts` (~30 lines) and used for **every** secret column (03 §2).

| Secret | Stored | Who can read plaintext | Never appears in |
|---|---|---|---|
| GitHub PAT | encrypted (`App.accessTokenEnc`) | nobody via API; decrypt only inside the deploy pipeline | API responses (only `{present, last4}`), logs (redacted) |
| Webhook secret | encrypted (`App.webhookSecretEnc`) | only the create/rotate responses (06 §5) | app JSON, logs |
| Env values | encrypted (`EnvVar.valueEnc`) | member/admin via env API; viewer sees `masked` (06 §9) | logs, events |
| Passwords | argon2id hash | — | anywhere |
| JWT signing key | `SWIM_JWT_SECRET` env var | — | DB, logs |

Rules:

- Event `details` objects are fixed, small shapes (05 §5) — audit rows must never carry secret values; this is a code-review invariant, not just convention.
- **Key rotation is a documented gap**: there is no re-encryption command in v1. Changing `SWIM_SECRET_KEY` makes stored PATs, webhook secrets, and env values undecryptable (deploys fail until each app's secrets are re-entered). Accepted; the mitigation is per-app secret rotation via the dashboard. Hardening path: a maintenance command that decrypts-with-old and re-encrypts-with-new.

## 5. Transport & headers

- HTTPS everywhere via Let's Encrypt (09); plain HTTP 301-redirects except `/.well-known/acme-challenge/` (09 §3).
- **No CORS configuration exists** — dashboard and API are same-origin (06 intro). Cross-origin calls fail by default.
- helmet defaults (03 §2): HSTS, `X-Content-Type-Options: nosniff`, frame-deny, referrer policy.
- CSRF: mutating API routes require a `Bearer` header (not cookie auth), and the refresh cookie is SameSite=Strict + path-scoped — cross-site form posts and top-level navigations cannot drive state-changing API calls. No CSRF token needed; this is the documented rationale.

## 6. Webhook security

- **Signature**: HMAC-SHA256 over the raw body, compared with `crypto.timingSafeEqual` (06 §12). The hooks router mounts `express.raw` and verifies **before** any JSON parsing.
- **Capability**: `hookId` is an unguessable UUIDv4; rotate-hook replaces the id + secret together (05 §2), instantly invalidating the old URL.
- **Response discipline**: 202 immediately, never blocking on deploys (DoS-resistant); 60 req/min per hookId (06 §14).
- **Payload contents are not trusted**: a webhook only triggers a deploy of the *tracked branch HEAD as git reports it* — the commit SHA in the payload is ignored; `services/git.ts` resolves the real HEAD after fetch (07 §3). A forged-but-signed push cannot inject an arbitrary SHA even if the signature check were ever bypassed.

## 7. Command execution rules

1. Only `services/*` spawn subprocesses (04 §5), always via `spawn` with **fixed argument arrays** — never `exec`, never interpolated shell strings (03 §6 rule 6).
2. User-influenced strings that do reach command lines (`slug`, `branch`, `host`) all pass zod shape validation first (06 §5, §8): slug `[a-z0-9-]{3,30}`, anchored hostname and branch regexes. No free-form string ever becomes a command argument.
3. **Redaction**: `lib/exec.ts` accepts a redact list; any output line containing a supplied secret is rewritten to `[REDACTED]`. The PAT is on the list for every git/compose invocation (07 §3) — mandatory, tested.
4. The api runs as the unprivileged `node` user (08 §3); no sudo, no root fallback anywhere in the image.

## 8. Rate limiting & abuse

| Limiter | Scope | Rule |
|---|---|---|
| authLimiter | setup, login, refresh | 10/min per IP |
| apiLimiter | all `/api/*` except hooks/health | 300/min per user (IP when unauthenticated) |
| hookLimiter | `/api/hooks/*` | 60/min per hookId |

429 responses carry `rate_limited` + `Retry-After` (06 §14). Failed logins are evented (`auth.login_failed`) and inspectable by admins. **No account lockout in v1** — deliberate: limiter + audit is the v1 answer, because lockout turns an attacker into a DoS-on-user tool.

## 9. Audit trail

Every action in the 05 §5 vocabulary is written synchronously within the same request that caused it; `services/audit.ts` never throws (a failed event write must not fail the request). Events survive app and user deletion via nullable `userId` (05 §4) and are pruned after 180 days (05 §6).

## 10. Accepted risks & non-goals (explicit)

| Risk / gap | Status |
|---|---|
| Apps sharing `swim-edge` can reach each other (and swim-api) | accepted v1 (01 §3); hardening path in 08 §7 |
| Mounted docker.sock is root-equivalent on the host | accepted, mitigated (08 §4); rootless Docker is the operator-side escape hatch |
| A repo's Dockerfile executes arbitrary code during build | inherent to the product; the container + non-root defaults are the boundary; no build isolation (Kata, rootless builders) in v1 |
| No 2FA / SSO | non-goal v1 |
| No per-app RBAC | non-goal v1 (02 §3) |
| No `SWIM_SECRET_KEY` re-encryption command | accepted gap (§4) |
| XSS in the dashboard | mitigated: React/MUI escaping, no `dangerouslySetInnerHTML`, httpOnly cookie limits blast radius; no custom CSP beyond helmet in v1 |
| Certbot HTTP-01 on port 80 | standard ACME practice; only the challenge path is exempt from the HTTPS redirect (09 §3.2) |

Next: `11-testing-strategy.md`.
