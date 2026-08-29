# 021 — A cookie session for the browser client, so refresh tokens can leave `localStorage`

Decision: D-052, and a second correction to D-037. Log: Entry 025.

## The problem, and why the obvious fix was the wrong one

The deployed client web build kept `boe.client.accessToken` and `boe.client.refreshToken` in
`localStorage`. A refresh token there is a full session-takeover primitive: any injected script can
read it, and it is valid for thirty days regardless of how short the access token's life is.

Somebody had already fixed this the obvious way — set `persistSecrets` to native-only — and it was
reverted the same day. The reason is worth stating precisely, because it is not obvious: a browser
SPA loses its JavaScript heap on **every full document load**, not merely on an explicit refresh.
`frontend-ts-smoke.mjs` navigates with `page.goto` throughout, so the session died on nearly every
screen and the suite fell from 71/71 to 44/49. `localStorage` was not a mistake in the frontend; it
was the only place a bearer session could survive a navigation.

So the order is forced. The replacement mechanism has to exist before the storage can be removed.

## What was built

The admin console already had the mechanism: an HttpOnly access cookie, an opaque rotating refresh
cookie, and a synchronizer CSRF token, with a `GET .../csrf` endpoint that re-issues the CSRF token
after a reload from the cookies alone. The client scope now has the same four endpoints:

```
POST /v1/auth/client/web/login
POST /v1/auth/client/web/refresh
GET  /v1/auth/client/web/csrf
POST /v1/auth/client/web/logout
```

`domain/auth/webAuth.ts` was made generic over a `WebAuthScope` rather than copied. There is one
`webLogin`, one `webRefresh`, one `webRecoverCsrf`, one `authenticateCookieSession`; a scope descriptor
supplies the cookie names, the session channel, the audit command and actor type, the principal
builder and the login-eligibility rule. The rotation state machine — the 30-second previous-pair
grace, the same-`rotationId` reproduction, the family revocation on reuse — is the subtle part and the
part a second copy would have drifted on.

The client app now picks its transport from the shell it runs in. On Android, `isNative()` is true and
nothing changed: the bearer pair, Capacitor Secure Storage, `/v1/auth/native/*`. In a browser it is
cookies, and `persistSecrets` is `isNative()`, so nothing credential-shaped is written to
`localStorage` at all. `purgeLegacyLocalSecrets()` runs on both platforms, so a browser that still
holds secrets from an earlier build is cleaned on its next load — which is now safe, where under the
reverted change it wiped the live tokens.

## The scopes cannot be crossed

The client browser session is a **third session channel**, `client_web`, not a second `web` session.
That matters: `authenticateWebRequest` admits any active `web` session, so a client cookie on the
`web` channel would have satisfied the admin console's authentication step and been stopped only by
the permission check behind it. Permissions are per-user and a user can hold both roles; authorization
is the wrong layer for this.

Four independent things now have to agree before a cookie authenticates a request:

1. The cookie **name** — `boe_client_access` versus `boe_access`. Neither path reads the other's.
2. The session **channel**, required exactly by each authentication path. `authenticateNativeRequest`
   still requires `native`, so neither cookie value works as a bearer token either.
3. **Rotation** refuses a refresh cookie whose session is not on the scope's channel, and the CSRF
   re-issue carries the channel in its `WHERE`.
4. The **CSRF material** lives on the session row, and the two audiences never share one.

Logging out of one scope expires only its own four cookie names, so both sessions can live in one
browser without either disturbing the other.

## Two things found while building it

**The admin refresh has never worked.** `adminRuntime` called `webRefresh` with
`unauthenticated: true` — which is exactly the flag that suppresses the automatic `x-csrf-token`
header — so the backend answered CSRF_INVALID and the console signed the operator out ten minutes into
every session instead of rotating. The smoke suite finishes well inside that ten minutes, which is why
nothing noticed. Fixed the same way the new client path works: recover the token, then rotate with it
passed explicitly.

**A stale CSRF token does not just fail a refresh, it revokes the session family.** The rotation
treats a non-matching synchronizer token as refresh reuse. An in-memory token can legitimately be one
rotation behind — a second tab rotated first, or the document has not restored yet — so both refresh
paths now fetch a fresh token from `.../csrf` before rotating. One extra GET per ten minutes buys a
multi-tab-safe refresh.

## What is not proven

Everything about the runtime. The migration has not been applied, no cookie has been issued, and the
smoke suite has not been run — it needs the local stack, which this machine does not start. The
scope-isolation argument above is four predicates read in source, not an attack that was executed.
Entry 025 carries the exact commands: the migration status check, a login-to-read round trip, the
rotation, and the four cross-scope replays that should each answer `SESSION_INVALID`.
