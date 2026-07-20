# Session 7 deploy notes

## Production shape

- nginx is the only internet-facing service on 443.
- Landing runs behind nginx on `127.0.0.1:3100`.
- Backend runs behind nginx on `127.0.0.1:47502`.
- Public API URL for APKs is `https://<domain>/v1`.
- Browser signup uses landing `/api/auth/signup`; the landing server injects
  `x-signup-key` from `SIGNUP_PROXY_SECRET`.
- Direct backend signup without `x-signup-key` returns 403.

## Required environment

Backend:

```bash
HOST=127.0.0.1
PORT=47502
SIGNUP_ALLOWED_ORIGIN=https://<domain>
SIGNUP_PROXY_SECRET=<same-long-secret-as-landing>
```

Landing server:

```bash
BEO_API_BASE=http://127.0.0.1:47502
SIGNUP_ALLOWED_ORIGIN=https://<domain>
SIGNUP_PROXY_SECRET=<same-long-secret-as-backend>
```

Android APK production:

```bash
VITE_BEO_API_BASE_URL=https://<domain>/v1
VITE_BEO_WEB_ONBOARDING_URL=https://<domain>/signup
```

## nginx

Use `frontend_stack/deploy/nginx.single-port.example.conf` as the template.
Replace `example.com` and certificate paths before installing it.
