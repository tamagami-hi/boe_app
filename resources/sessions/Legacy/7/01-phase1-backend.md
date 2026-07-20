# Phase 1 — Backend: `username` field + signup origin/secret gate

**Goal:** account creation works with the full field set and is creatable
**only** from the landing page. Login/existing-user traffic stays open. Admin
auth already works via `.env` — do not touch it.

All paths are under `backend_controller/`.

## Files to change

| File | Action | Why |
|---|---|---|
| `src/config/env.js` | UPDATE | Add `signupAllowedOrigin`, `signupProxySecret` |
| `src/shared/services/authService.js` | UPDATE | Add `assertSignupAllowed` gate + `username` support |
| `src/shared/routes/authRoutes.js` | UPDATE | Signup body schema → `{ name, username, email, phone, password }` |
| `src/db/migrations/<n>_add_username.sql` | CREATE | PG `username` column + unique index |
| `src/shared/services/authService.signup.test.js` | CREATE | Unit-test the gate + username uniqueness (jsonStore) |
| `.env.example` (root) + `backend_controller/.env` | UPDATE | New signup env vars |

## Task 1 — config

In `src/config/env.js`, in the returned config object (after the `adminUserId`
line, ~line 94), add:

```js
    signupAllowedOrigin: env.SIGNUP_ALLOWED_ORIGIN || '',
    signupProxySecret: env.SIGNUP_PROXY_SECRET || '',
```

(Optional, recommended) In the production validator (`assertProductionConfig`,
~line 146+), warn/error if **neither** `signupProxySecret` nor
`signupAllowedOrigin` is set in production — otherwise signup is ungated.

## Task 2 — signup gate + username (`authService.js`)

Mirror existing helpers (`safeEqualText`, `normalizeEmail`, `normalizePhone`,
`HttpError`). Add near the other helpers:

```js
// Account creation is allowed ONLY from the landing page. Primary control is a
// server-injected shared secret (the landing's Next proxy sets x-signup-key);
// Origin is a softer fallback. Existing-user endpoints are NOT gated.
export function assertSignupAllowed(config, headers = {}) {
  const secret = String(config.signupProxySecret || '');
  if (secret) {
    const provided = String(headers['x-signup-key'] || '');
    if (!safeEqualText(provided, secret)) {
      throw new HttpError(403, 'SIGNUP_NOT_ALLOWED', 'Account creation is not permitted from this client.');
    }
    return;
  }
  const allowedOrigin = String(config.signupAllowedOrigin || '');
  if (allowedOrigin) {
    const origin = String(headers.origin || '');
    if (origin !== allowedOrigin) {
      throw new HttpError(403, 'SIGNUP_NOT_ALLOWED', 'Account creation is not permitted from this origin.');
    }
    return;
  }
  // Neither configured → dev-permissive. Production must set one (see validator).
}

const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;
function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}
```

In `signup(body, config, requestContext = {})`:
1. **First line:** `assertSignupAllowed(config, requestContext.headers || {});`
2. Validate username:
   ```js
   const username = normalizeUsername(body.username);
   if (!USERNAME_PATTERN.test(username)) {
     throw new HttpError(400, 'USERNAME_INVALID', 'Username must be 3–30 chars: lowercase letters, numbers, underscore.');
   }
   ```
3. jsonStore path: include `username` in the new record, and extend the
   uniqueness check: `store.users.some(u => u.email === email || u.phone === phone || u.username === username)`.
   On collision keep returning `409 ACCOUNT_EXISTS` (or a `USERNAME_TAKEN` variant).
4. PG path: add `username` to the `INSERT` column list + `$6` param and to
   `RETURNING`. The `23505` unique-violation catch already maps to `409`.
5. Thread `username` through `toApiUser` (`username: row.username`),
   `jsonUserToRow` (`username: user.username`), `rowToJsonUser`
   (`username: row.username`). Login/refresh PG `SELECT`s may optionally add
   `username` to return it in the session user (not required for auth).

> Note: the signup route service already receives `headers` via
> `requestContext.headers` (see `authRoutes.js` signup handler passing `{ headers }`).

## Task 3 — route schema (`authRoutes.js`)

Replace the signup `validateBody` schema with:

```js
    validateBody(body, {
      name: { required: true, type: 'string', minLength: 1 },
      username: { required: true, type: 'string', minLength: 3 },
      email: { required: true, type: 'string', pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
      phone: { required: true, type: 'string', minLength: 6 },
      password: { required: true, type: 'string', minLength: 8 },
    });
```

(Confirm `phone` is the mobile field the service reads — `signup()` uses
`normalizePhone(body.phone)`.)

## Task 4 — PG migration

Create `src/db/migrations/<next-number>_add_username.sql` (match existing numbering/style):

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS username text;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users (lower(username)) WHERE username IS NOT NULL;
```

Applied by `npm run migrate` (psql) before PG use. Dev (jsonStore) needs no migration.

## Task 5 — env

Root `.env.example` and `backend_controller/.env`:

```
# Account creation is allowed only from the landing page.
SIGNUP_ALLOWED_ORIGIN=http://127.0.0.1:5173
SIGNUP_PROXY_SECRET=change-me-to-a-long-random-string
```

## Task 6 — test (TDD)

`src/shared/services/authService.signup.test.js` (run with `node --test`):
- `assertSignupAllowed` throws 403 when secret configured but header missing/wrong.
- passes when `x-signup-key` matches.
- falls back to origin when only `signupAllowedOrigin` is set (match vs mismatch).
- allows when neither configured (dev).
- (If feasible with a temp jsonStore config) `signup` rejects an invalid username
  and enforces username uniqueness (409).

## Acceptance
- [ ] Signup requires `name, username, email, phone, password`; stores username; unique.
- [ ] Signup returns 403 unless `x-signup-key` (or allowed Origin) matches.
- [ ] Login / refresh / admin `.env` login unchanged and origin-agnostic.
- [ ] `node --test` green; relevant `authz:*` guard green.
