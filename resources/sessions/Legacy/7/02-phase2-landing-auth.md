# Phase 2 — Landing: login + signup + post-login browsing

**Goal:** the landing page (the only public web surface) lets users **sign up**
(6 fields) and **log in**, talking to the backend through a **same-origin
server-side proxy** that injects the signup secret. After login, users browse
the education content freely.

All paths under `frontend_stack/packages/landing_page/`.

## Why Route Handlers (not a rewrite) for auth

`next.config.mjs` `rewrites()` can proxy paths but **cannot inject a secret
header**. Signup must carry `x-signup-key` (server-only). So use **Next Route
Handlers** that run on the landing server, attach the secret from
`process.env.SIGNUP_PROXY_SECRET`, forward to the backend, and pass `Set-Cookie`
back to the browser. Tokens stay in httpOnly cookies; the browser never sees the secret.

## Files to create

| File | Purpose |
|---|---|
| `src/app/api/auth/signup/route.ts` | POST → inject `x-signup-key` → `{BEO_API_BASE}/v1/auth/signup`; relay body + Set-Cookie |
| `src/app/api/auth/login/route.ts` | POST → `{BEO_API_BASE}/v1/auth/login`; relay body + Set-Cookie (no secret) |
| `src/app/api/auth/logout/route.ts` | POST → `/v1/auth/logout`; clear cookies |
| `src/lib/auth.ts` | client helpers: `signup/login/logout/getStoredUser`; signup validation (6 fields + confirm match) |
| `src/components/AuthProvider.tsx` | `useAuth()` context; reads stored user; exposes `user`, `login`, `signup`, `logout` |
| `src/components/SignupForm.tsx` | client form: name, username, email, mobile, password, confirm |
| `src/components/LoginForm.tsx` | client form: identifier (email/username/phone) + password |
| `src/app/signup/page.tsx` | renders SignupForm |
| `src/app/login/page.tsx` | renders LoginForm |
| `src/lib/auth.test.ts` | vitest: signup validation (confirm mismatch, username rule, email, mobile) |

## Files to update

| File | Change |
|---|---|
| `src/content/nav.ts` | `authLinks.signIn.href = '/login'`, `authLinks.signUp.href = '/signup'` (drop the external client-app URL) |
| `src/components/Nav.tsx` | Wrap with `useAuth()`: when authed, show `Hi {name}` + Log out instead of Sign in/Sign up |
| `src/app/layout.tsx` | Wrap children in `<AuthProvider>` |
| `.env.example` | Add `SIGNUP_PROXY_SECRET=` (server) — must equal the backend's value |
| `README.md` | Document auth flow + the secret |

## Route Handler shape (signup)

```ts
// src/app/api/auth/signup/route.ts
import { NextRequest, NextResponse } from 'next/server';

const BACKEND = (process.env.BEO_API_BASE || 'http://127.0.0.1:47502').replace(/\/$/, '');

export async function POST(req: NextRequest) {
  const body = await req.json();
  const upstream = await fetch(`${BACKEND}/v1/auth/signup`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signup-key': process.env.SIGNUP_PROXY_SECRET || '',
      // forward Origin so the backend's fallback origin-gate also passes
      origin: process.env.SIGNUP_ALLOWED_ORIGIN || req.headers.get('origin') || '',
    },
    body: JSON.stringify(body),
  });
  const data = await upstream.json().catch(() => ({}));
  const res = NextResponse.json(data, { status: upstream.status });
  // relay backend Set-Cookie (httpOnly access/refresh tokens) to the browser
  const setCookie = upstream.headers.get('set-cookie');
  if (setCookie) res.headers.set('set-cookie', setCookie);
  return res;
}
```

`login/route.ts` is the same without `x-signup-key`. (If multiple Set-Cookie
headers need relaying, read `upstream.headers.getSetCookie()` and append each.)

## Auth state

- `lib/auth.ts#signup(values)` validates the 6 fields client-side (mirror
  backend: username `^[a-z0-9_]{3,30}$`, valid email, mobile ≥10 digits,
  password ≥8, `password === confirmPassword`), then `POST /api/auth/signup`.
- On success the backend returns `{ user, accessToken, refreshToken }` and sets
  httpOnly cookies. Store **only** `user` in `localStorage` (key `beo.landing.user`)
  to drive the authed UI; never store tokens in JS-readable storage.
- `AuthProvider` hydrates from `localStorage`; `logout()` calls `/api/auth/logout`
  and clears the stored user.
- Post-login: education content is already public, so "explore freely" mainly
  means the nav reflects the authed user (name + Log out) and any future
  member-only areas read `useAuth()`.

## Acceptance
- [ ] `/signup` creates an account via the proxy (secret injected server-side); browser never sees the secret.
- [ ] `/login` authenticates; httpOnly cookies set; nav shows authed state.
- [ ] Signup form enforces all 6 fields + confirm-password match before submit.
- [ ] `next build` + `vitest` green.
- [ ] A direct `POST` to the backend `/v1/auth/signup` **without** the secret → 403 (proves the gate).
