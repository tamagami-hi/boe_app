# Session 7 — APK-only app/admin, landing as sole public web surface

> **Status:** Planned, awaiting implementation. Phases 1–2 are the immediate
> work; Phases 3–4 follow after a token/cost check.
> **Source of truth:** this folder. Read this file first, then the per-phase files.

This document is a self-contained handoff. A fresh session should be able to
execute it without re-investigating the codebase.

---

## 1. Product / architecture decisions (confirmed with the user)

The platform has **two deliberately separated surfaces** plus a backend:

| Surface | Runs as | Audience | Notes |
|---|---|---|---|
| **Landing page** (Next.js, `frontend_stack/packages/landing_page`) | Public website | Anyone | The **only** public web surface. Finance **education** only (courses + premium news). Now also hosts **login + signup**. |
| **User app** (`@beonedge/client`) | **Android APK only** | Eligible users | No desktop/browser view. Investing happens here. |
| **Admin** (`@beonedge/admin`) | **Android APK only** (separate APK) | Admins | No public web. Admin creds are hardcoded in `.env`. Web-admin kept for **local dev only**. |
| **Backend** (`backend_controller`) | Node HTTP API `:47502` | — | Stays where it is. One new feature: gate account creation to the landing origin. |

### Key rules
- **Account creation (signup)** is allowed **only from the landing page** (enforced
  by the backend via a proxy secret / origin, configured from `.env`).
- **Existing-user traffic** (login, refresh, investing, admin) is allowed **from any origin**
  (the APKs are native clients with no fixed browser origin).
- **Signup fields:** `name`, `username`, `email`, `mobile`, `password`, `confirm password`.
  This creates the **real credentialed account** that eligible users later log into in the **user APK**.
- **Admin:** no self-signup. Admin `username` + `password` come from `.env`
  (`ADMIN_LOGIN_ID` / `ADMIN_PASSWORD` already exist). Login via the **admin APK**.
- **After login on the landing (web):** the user can freely browse the site and
  the financial-education products. (Investing is APK-only, not on web.)
- **User APK and Admin APK are two separate Android apps.**

---

## 2. Deployment topology (the secure, single-port answer)

Landing + backend live on the **same VPS**. The app and admin are APKs, so there is
**no admin/client web surface to deploy** — the only public web app is the landing page.

**Production (single public port):**

```
Internet ──443/TLS──> nginx (only internet-facing service)
                         ├─ /          → landing page (Next.js)
                         └─ /v1/*       → backend (bound to 127.0.0.1 ONLY)
APKs (user + admin) ───> https://<domain>/v1/...
Landing ──────────────> /v1 same-origin (no CORS, no second port)
```

Why this is the secure choice:
- One TLS endpoint, one attack surface.
- Backend is **not** directly reachable from the internet (binds `127.0.0.1`, behind nginx).
- Signup is locked to the landing; everything else is open from any origin.

**Dev mirror:** landing on one port proxies `/v1` (and `/api`) to the backend; APKs hit the backend dev host directly.

---

## 3. Where everything lives (dev ports)

| Piece | Dev | Prod |
|---|---|---|
| Backend | `127.0.0.1:47502` | `127.0.0.1:47502` behind nginx `/v1` |
| Landing (public, login+signup, education) | `:3100` | nginx `/` |
| User app | Android APK (Capacitor build of `ClientRoot`) | APK |
| Admin app | Android APK (future build target) | APK |
| Web-admin | **local dev only** (`BrowserRoot`), not deployed | — |

> Web vs APK entry is chosen at build time in `frontend_stack/app/src/main.jsx`:
> `VITE_BEO_APP_TARGET=client` → `ClientRoot.jsx` (APK); else → `BrowserRoot.jsx` (web).
> Removing the client's *web* view = edit `BrowserRoot.jsx` only; the APK (`ClientRoot`) is untouched.

---

## 4. What already exists (do NOT rebuild)

Confirmed in `backend_controller/src/shared/services/authService.js` +
`src/shared/routes/authRoutes.js` + `src/security/passwords.js` + `src/config/env.js`:

- `POST /v1/auth/login`, `/v1/auth/signup`, `/v1/auth/logout`, `/v1/auth/refresh`, `GET /v1/auth/session` — all registered.
- Password hashing: **scrypt** (`hashPassword` / `verifyPassword`).
- Users persist in **jsonStore** (dev) and **Postgres** (prod) via `db/store.js`.
- **Admin `.env` login already works** — `envAdminLogin` validates `config.adminPassword`
  and `config.adminLoginId` (`ADMIN_LOGIN_ID` / `ADMIN_PASSWORD`). **Nothing to build for admin auth.**
- Signup today accepts `email, phone, password, name` → role `client`, status `pending_review`,
  issues access/refresh tokens + httpOnly cookies.

Landing page (built in session 6, `frontend_stack/packages/landing_page`):
- Next.js 14 App Router + TS + vanilla CSS tokens. Excluded from the npm workspace.
- Sections: Nav, Hero, CourseCatalog, PremiumBenefits, LearningMethod, FinancialNews,
  SocialProof, Plans, LeadForm, Footer. Config-driven content in `src/content/*`.
- `next.config.mjs` already proxies `/api/onboarding/:path*` → `{BEO_API_BASE}/v1/onboarding/:path*`.
- `src/lib/validation.ts` + `src/lib/onboarding.ts` (lead form). Vitest unit tests pass.

---

## 5. Gaps to close (the actual work)

Phase 1 (`01-phase1-backend.md`) — backend: add **`username`** + the **signup origin/secret gate**.
Phase 2 (`02-phase2-landing-auth.md`) — landing: **login + signup forms**, server-side
proxy route handlers that inject the signup secret, post-login authed browsing.
Phase 3 (`03-phase3-retire-web-app.md`) — retire client web routes (`BrowserRoot`), keep web-admin dev-only.
Phase 4 (`04-phase4-single-port-deploy.md`) — nginx single-port config + dev `/v1` proxy + APK API base.

---

## 6. Sequencing & guardrails

- **Do Phase 1 + 2 first.** Pause for the user to check token/cost before Phase 3 + 4.
- This is **security-sensitive** (account creation, passwords). Run the backend
  `authz:*` guards for any area touched, and a security review before merge.
- Backend logic stays the same except the **signup gate** (explicitly requested).
- Keep changes cohesive; many small files.

### Validation commands
```bash
# Backend (from backend_controller/)
node --test                      # colocated *.test.js (incl. new gate test)
npm run authz:jwt-status         # if auth/session touched
node scripts/start-dev.js        # smoke the API

# Landing (from frontend_stack/packages/landing_page/)
npm run build && npm test        # next build + vitest

# Web-admin dev build (from frontend_stack/)
npm run dev                      # vite; confirm /admin still works (dev-only)
```

### Env vars introduced
| Var | Where | Purpose |
|---|---|---|
| `SIGNUP_ALLOWED_ORIGIN` | backend `.env` | Landing origin allowed to create accounts (fallback gate) |
| `SIGNUP_PROXY_SECRET` | backend `.env` **and** landing server env | Shared secret the landing proxy injects as `x-signup-key` (primary gate) |
| `BEO_API_BASE` | landing server env | Backend base for the landing's server-side proxy (already used) |
| `NEXT_PUBLIC_BEO_APP_BASE` | landing | (legacy from session 6) client app host — becomes unused once web client is retired |
