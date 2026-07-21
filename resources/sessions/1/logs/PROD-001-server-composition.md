# PROD-001 Backend server composition wiring

Status: DONE — branch `ts-migration/backend` (PR #1). Resolves the "production
`server.ts` wiring" deferral carried since BE-010/BE-011/BE-012/BE-016: the
canonical routes now serve on a running server.

## Change

- `src/runtime/composition.ts` — `composeBackend(env)` parses the environment
  (database, crypto keys, server config, breach mode), constructs the shared
  singletons (pool, database, unit of work, crypto context, ES256 access-token
  service, breach checker, SNS certificate fetcher, and all repositories), and
  returns `{ registerRoutes, checkReadiness, dispose }`. `registerRoutes` wires
  every canonical first-slice route group onto the Fastify instance: health/
  readiness, public onboarding, native auth, web auth, admin identity, and the
  SNS provider-event ingress.
- `src/runtime/environment.ts` — added `parseServerConfig`: ES256 keyring
  (issuer/audience/current kid/PKCS8 signing PEM/SPKI verification map),
  base64 32-byte refresh + cursor HMAC keys, key versions, web cookie/origin
  config, SES/SNS config, provider-event + token/idempotency/invite TTLs. Fails
  fast on missing/malformed values (bad key length, bad JSON, missing current
  kid, empty origin allowlist).
- `src/email/certificateFetcher.ts` — SSRF-hardened SNS signing-certificate
  fetcher: rejects hosts resolving to loopback/private/link-local/CGNAT/multicast
  (IPv4, IPv6, and IPv4-mapped IPv6) before a single HTTPS GET with no redirects,
  a bounded timeout, and a size cap. DNS lookup and fetch are injectable.
- `src/server.ts` — `startServer` now composes the backend, registers all routes,
  and closes the pool as part of the graceful drain (`onClose` -> `dispose`).
- `scripts/smoke-entrypoint.ts` — injects a complete ephemeral environment
  (generated ES256 keypair + random keys) so both smokes boot the **full**
  composed server (all routes wired), not just `/health/live`.
- `.env.example` — replaced the stale legacy variables with the canonical
  deployment environment.

## Tests

- `src/runtime/composition.test.ts` — boots the composed routes on a Fastify
  instance and asserts `/health/live` 200, `/v1/health` envelope, `/health/ready`
  degraded (503, no config leak) with an unreachable database, a reachable
  canonical route, and clean `dispose`; plus `parseServerConfig` happy path and
  five fail-fast branches.
- `src/email/certificateFetcher.test.ts` — the private-address guard matrix and
  the fetch happy/blocked/oversize/non-200/unresolved paths with injected
  lookup/fetch.
- `src/server.test.ts` — updated to supply the composition environment; asserts
  health + degraded readiness on a real listening socket and a clean close.

## Verification

- `npm run check` green — including both **source and dist smokes booting the
  full composed server** end to end.
- `npm run test:integration` green (63/63).
- Guards: `git diff --check` clean; Legacy hash intact; backend authored JS
  still **0**; `package.json`/`package-lock.json` unchanged (no new dependency —
  the certificate fetcher uses the Node runtime).

## Still deferred

- The **email delivery worker** entrypoint (which needs a concrete Amazon SES v2
  sender adapter) runs as a separate background process and is intentionally not
  part of the HTTP server composition; the worker command
  (`dispatchDueDeliveries`) and its `SesEmailSender` port already exist (BE-012).
