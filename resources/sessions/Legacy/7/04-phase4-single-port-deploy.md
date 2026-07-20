# Phase 4 — Single-port deployment + backend not internet-facing

**Goal:** on the VPS, expose **one** public port. nginx serves the landing at `/`
and reverse-proxies `/v1` to the backend, which binds to `127.0.0.1` only. The
APKs hit `https://<domain>/v1`. No second web port (admin/app are APKs).

> Do this after Phase 3 (user pauses for a token/cost check first).

## Files to change

| File | Action | Why |
|---|---|---|
| `frontend_stack/app/nginx.conf` (or a new deploy conf) | UPDATE/CREATE | `/` → landing, `/v1` → backend |
| `frontend_stack/packages/landing_page/next.config.mjs` | UPDATE | Ensure `/v1` (or `/api/*`) proxies to backend in dev |
| `frontend_stack/app/.env.android` | UPDATE | User APK `VITE_BEO_API_BASE_URL=https://<domain>/v1` |
| backend run config | VERIFY | Bind `127.0.0.1`; never expose `:47502` publicly |
| `resources/sessions/7/` deploy notes | CREATE | Document VPS bring-up |

## nginx (production sketch)

```nginx
server {
  listen 443 ssl http2;
  server_name <domain>;
  # ssl_certificate ... ; ssl_certificate_key ... ;

  # Public web = landing page (Next.js, served by `next start` or static export)
  location / {
    proxy_pass http://127.0.0.1:3100;   # landing (next start)
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Backend API for APKs + landing. Backend binds 127.0.0.1 only.
  location /v1/ {
    proxy_pass http://127.0.0.1:47502;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Origin $http_origin;   # preserve Origin for the signup gate
  }
}
# Redirect :80 → :443 in a second server block.
```

Notes:
- Landing's server-side proxy (`/api/auth/*`, `/api/onboarding/*`) talks to the
  backend over `127.0.0.1` and injects `x-signup-key`. Browser signup goes
  through that handler — so the **signup secret never leaves the VPS**.
- Direct APK calls to `/v1/auth/signup` will **fail the gate** (no secret) by
  design — APKs only **log in**; account creation is web-only.
- Set `BEO_API_BASE=http://127.0.0.1:47502` and `SIGNUP_PROXY_SECRET=<same as backend>`
  in the landing's server env (systemd unit / PM2 / Docker).

## Dev mirror

- Landing dev: `next dev` (`:3100`); `next.config.mjs` proxies `/api/*` and
  optionally `/v1/*` → `BEO_API_BASE`.
- Backend dev: `node scripts/start-dev.js` (`:47502`).
- User APK dev: `.env.android` → backend dev host (`http://10.0.2.2:47502` for the
  Android emulator).

## Backend exposure

- Confirm the backend listens on `127.0.0.1` (or behind Docker network), never a
  public `0.0.0.0:47502`. Only nginx reaches it.
- CORS: largely moot (landing is same-origin via proxy; APKs are native). Leave
  `CORS_ORIGIN` as-is; the signup gate (Phase 1) is the real control.

## Acceptance
- [ ] One public port (443); backend not reachable directly from the internet.
- [ ] `https://<domain>/` serves the landing; `https://<domain>/v1/...` reaches the backend.
- [ ] Browser signup works (secret injected); direct APK signup is blocked (403).
- [ ] User APK login works against `https://<domain>/v1`.
