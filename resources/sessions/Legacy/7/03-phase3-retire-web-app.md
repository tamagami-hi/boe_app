# Phase 3 — Retire the client web view (keep web-admin dev-only)

**Goal:** the user app is **APK-only**. Remove its browser/desktop routes and any
"open the desktop app" links. Keep the admin web build usable for **local dev
only** (the admin APK doesn't exist yet). The APK build (`ClientRoot`) is untouched.

> Do this only after Phases 1–2 are approved (user pauses for a token/cost check).

All paths under `frontend_stack/`.

## Background (confirmed)

- `app/src/main.jsx` selects the root by build target:
  `VITE_BEO_APP_TARGET=client` → `ClientRoot.jsx` (**APK**); else → `BrowserRoot.jsx` (**web**).
- So the **client APK uses `ClientRoot`** and is unaffected by editing `BrowserRoot`.
- After session 6, `BrowserRoot.jsx` already: redirects `/` (desktop) → landing,
  serves `/app/*` (client) and `/admin/*` (admin); the legacy `website` package is gone.

## Files to change

| File | Action | Why |
|---|---|---|
| `app/src/BrowserRoot.jsx` | UPDATE | Remove client web routes; make it admin-only (dev) |
| `packages/client/src/utils/openOnboarding.js` | KEEP | Used by the APK signup → opens landing `#lead`/`/signup`; fine to leave |
| `packages/client/src/pages/Login.jsx` | REVIEW | Its "Sign up" (`openOnboarding`) now points to landing — confirm still desired in APK |
| `app/vite.config.js` | KEEP | `@beonedge/client` alias stays (APK build needs it) |

## `BrowserRoot.jsx` target (web = admin-only, dev only)

Remove `ClientApp` import + `/app/*` route, and the client `/login` `/signup`
redirects. Since the web host is now only the dev admin portal, repoint `/`:

```jsx
// web build is a DEV-ONLY admin portal now; app + admin ship as APKs.
<Routes>
  <Route path="/" element={<Navigate to="/admin/login" replace />} />
  <Route path="/admin/login" element={<Page><RouteErrorBoundary><AdminLogin /></RouteErrorBoundary></Page>} />
  <Route path="/admin/*" element={<RequireAdmin><Page><RouteErrorBoundary><Admin /></RouteErrorBoundary></Page></RequireAdmin>} />
  <Route path="*" element={<Navigate to="/admin/login" replace />} />
</Routes>
```

- Drop the `LANDING_URL` desktop redirect and the `ExternalRedirect` helper (no
  longer the public root — the landing is a separate deploy).
- Remove now-unused imports (`ClientApp`, `isMobileDevice`, `LANDING_URL`, etc.).
- Keep `SessionProvider`/`AdminSessionProvider` as required by admin.

## Retire "open desktop app" links

Search and remove/repoint any links that open the **client web** app:
```bash
grep -rnE "/app/login|/app/splash|VITE_BEO_LANDING_URL|window.location.*5173|openDesktop" frontend_stack --include=*.js --include=*.jsx | grep -v node_modules
```
- The landing's nav already moved to its own `/login` `/signup` in Phase 2 — ensure
  no landing link points back to the client web app.
- `openOnboarding.js` (APK) → landing is correct; keep.

## Do NOT touch
- `app/src/ClientRoot.jsx`, `@beonedge/client` package, Capacitor/APK config.
- `@beonedge/admin` package (admin APK will reuse it later).

## Acceptance
- [ ] `npm run dev` (vite) → `/admin/*` works; `/app/*` no longer served on web.
- [ ] `npm --workspace app run build:android` (client APK) still builds (`ClientRoot` path).
- [ ] No web link opens the desktop client app.
- [ ] Web-admin is documented as **local-dev-only**, not a deployed surface.
