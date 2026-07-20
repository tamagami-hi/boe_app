# Handoff 2 — Admin redesign complete; landing page must consume the published config

Date: 2026-06-11. Author: Claude (admin redesign session).
Status: admin side DONE and merged to main; landing consumption NOT started.

## One-paragraph summary

The admin portal was completely redesigned on `wt/admin` (now fast-forward
merged into `main` at `d0bcdd9`): routed per-domain IA, dark-ink sidebar
shell (`.ash-` CSS namespace), and a full **Site Control** domain where the
admin manages courses, plans, FAQs, and a **versioned landing-page content
config** (hero, explore tiles, social proof, premium benefits, learning
method, news digests, lead form, nav, site meta). The backend stores that
config in `app_config_versions` under `config_key = 'landing_page'` and
serves the latest published version at `GET /v1/public/landing-config`.
**The landing page does not read it yet.** Wiring that up, with per-section
fallback to its current hardcoded content, is the next task and belongs in
the `wt/landing` worktree.

## Topology (verified, all local)

| Piece | Where | Port | Notes |
|---|---|---|---|
| Postgres | docker `boe-postgres` | 127.0.0.1:5433 | THE single shared DB for everything local |
| Docker backend | `boe-backend` image | 127.0.0.1:47502 | rebuilt from merged main; serves landing-config (verified, v5 live) |
| Docker landing | `boe-landing` image | 127.0.0.1:3100 | reads backend via internal `http://backend:47502` |
| Worktree backend | `boe_app-admin/backend_controller` `npm run dev` | 127.0.0.1:47512 | same code as main now; same DB |
| Admin portal | `boe_app-admin/frontend_stack` `npm run dev` | 127.0.0.1:5173/admin/login | `app/.env` points at 47512 (can be re-pointed to 47502) |
| Spare landing | `boe_app-landing` `npm run dev` | 127.0.0.1:3110 | port changed in worktree commit `757fcd8`; `.env.local` points at 47502 |

Admin dev login: `admin@beonedge.local` / `admin` (env-admin from
`backend_controller/.env` ADMIN_LOGIN_ID/ADMIN_PASSWORD; worktree backend
DB URL: `postgres://boe_app:<pw>@127.0.0.1:5433/boe_app`, pw in the
`boe-postgres` container env). Watch out: auth routes are rate-limited to
30 requests / 15 min per IP, in-memory; restart the backend to reset when
automated browser tests trip it.

git state: `main = wt/admin = d0bcdd9`, main is AHEAD of origin/main
(unpushed). `wt/landing` has one local commit (`757fcd8`, port 3110).

## What was shipped (commits on main)

- `ac15a88` fix: env-admin actor restored in src/security/auth.js (the
  JSON-store removal deleted the only branch that made env-admin login
  usable; every /v1/admin route 401'd); also dropped nonexistent
  `t.date` column from adminTransactions.
- `66b9d49` feat: landing-config endpoints. `appConfigService.js`
  parameterized by config_key; new `landingConfigSchema.js` (recursive
  validator: optional sections, href allowlist `/ # https://`, array
  caps, 256 KB cap, strips unknown keys; colocated node --test file) and
  `landingConfigService.js` (key `landing_page`, audit action
  `landing_config.publish`). Routes: GET/PATCH `/v1/admin/landing-config`
  (admin RBAC), GET `/v1/public/landing-config` (public).
- `b6646f9` feat: admin shell. `navigation/nav.js` is the IA source of
  truth; `?tab=` URLs redirect via `navigation/legacyTabMap.js`; legacy
  screens remounted UNCHANGED via `context/LegacyAdminDataContext.jsx` +
  `pages/legacy/legacyRoutes.jsx`; shell CSS in
  `styles/desktop/shell.css` (.ash- namespace).
- `0c3a440` feat: Courses/Plans/FAQs managers under
  `features/site/` (drawer editors, status chips, ₹ paise conversion).
- `b580133` feat: landing content editor (`LandingContentPage.jsx`,
  section editors under `features/site/content/`,
  `landingDefaults.js` = verbatim copy of the landing page's hardcoded
  content, `useLandingConfig.js` deep-merges published over defaults,
  `contentLint.js` brand-rule warnings).
- `d0bcdd9` fix: AppBuilderScreen crash guard, mobile shell layout,
  removed dead AdminSidebar/AdminTopBar.

DB content right now: course `money-basics` (published), plan
`premium-monthly` (published), one draft FAQ, landing config at
version 5 (sections all present, content equals the landing page's
hardcoded copy except whatever was edited after this session).

## THE NEXT TASK: make the landing page render from the config

Worktree: `/home/nethunter07/PROJECTS/boe_app-landing` (branch `wt/landing`).
Package: `frontend_stack/packages/landing_page` (Next.js 14 App Router,
standalone output, port 3110 dev).

### Verified current state of the landing source (read 2026-06-11)

Backend-driven today (KEEP AS IS): only courses and plans.
- `app/api/courses/route.ts` → `${BEO_API_BASE}/v1/public/courses`
- `app/api/plans/route.ts` → `${BEO_API_BASE}/v1/public/plans`
- consumed via `lib/courses.ts` / `lib/plans.ts` (`cache: 'no-store'`)

Hardcoded today (THIS IS THE WORK): every other surface imports
`src/content/*.ts` statically. Files that import hardcoded content:
- `components/Hero.tsx` (also hardcodes eyebrow/title/lead/note/img inline)
- `components/Nav.tsx`, `components/Footer.tsx` (nav.ts, site.ts)
- `components/SocialProof.tsx` (socialProof.ts)
- `components/PremiumBenefits.tsx`, `components/LearningMethod.tsx` (benefits.ts)
- `components/FinancialNews.tsx` (news.ts)
- `components/LeadForm.tsx` (inline copy + interestOptions from plans.ts)
- `app/page.tsx` (bento "Explore" tiles inline)
- `app/premium/page.tsx`, `app/news/page.tsx`, `app/about/page.tsx`
- legal pages + `LegalLayout` (legal.ts — INTENTIONALLY stays hardcoded)
There is ZERO reference to `landing-config` anywhere in the landing source.

### The contract to consume

`GET {BEO_API_BASE}/v1/public/landing-config` returns the envelope:

```json
{ "ok": true, "data": {
    "id": "...", "version": 5,
    "config": { "meta": {...}, "nav": {...}, "hero": {...},
                "explore": {...}, "socialProof": {...}, "premium": {...},
                "learningMethod": {...}, "news": {...}, "leadForm": {...} },
    "publishedAt": "...", "publishedBy": null,
    "source": "postgres", "published": true } }
```

Before any publish exists it returns `config: null, published: false`.
EVERY section is optional. The exact field shapes are defined in
`backend_controller/src/shared/services/landingConfigSchema.js` and the
admin's defaults in
`frontend_stack/packages/admin/src/features/site/landingDefaults.js`
(both in the merged main; the defaults file mirrors the landing page's
current hardcoded content one-to-one, so shapes line up with the
existing `content/*.ts` types).

### Recommended implementation (matches the approved plan)

1. `src/lib/landingConfig.ts`: server-side fetch of
   `${process.env.BEO_API_BASE}/v1/public/landing-config` with
   `next: { revalidate: 300 }` (or `cache: 'no-store'` to mirror
   courses/plans), parse envelope, return `config | null`. Never throw:
   on any error return null.
2. Per-section resolution: `resolved = deepMerge(hardcodedDefaults,
   config?.[section])` or simpler `config?.section ?? hardcoded` per
   field group — the admin always publishes complete sections (its
   editor deep-merges before publish), so `config?.hero ?? heroDefaults`
   at section granularity is sufficient.
3. Thread the config through server components: fetch once in
   `app/page.tsx` (and `app/premium/page.tsx`, `app/news/page.tsx`,
   `app/layout.tsx` for nav/meta/footer) and pass section props into
   Hero/Nav/SocialProof/PremiumBenefits/LearningMethod/FinancialNews/
   LeadForm/Footer. Components keep their current markup; only their
   data source changes (props with hardcoded fallback defaults).
4. LeadForm is a client component: pass `leadForm` config as props from
   the server page (do not fetch client-side).
5. DO NOT touch: legal pages/content, auth/signup flow, courses/plans
   fetching, `next.config.mjs` rewrites.
6. Brand rules for any copy you add: no exclamation marks, no emoji, no
   em dashes, never abbreviate to "BOE"/"BE", Indian currency format.

### Verification for the consumption pass

1. Start the docker stack (or main backend on 47502) + landing worktree
   dev (`npm run dev` → 3110, `.env.local` already points at 47502).
2. Baseline: page renders identically to today (config v5 content ==
   hardcoded content, so no visual diff expected).
3. In the admin portal, edit the hero headline, Publish (creates v6);
   reload landing → new headline appears WITHOUT redeploying.
4. Stop the backend → landing still renders (hardcoded fallback).
5. `npm run landing:test` if tests exist in the package
   (`npm test` inside the landing package runs node --test).
6. Landing worktree commits stay on `wt/landing`; merge to main when
   verified; status.sh handles the release flow.

## Other open threads (not started, lower priority)

- Users domain rebuild (approvals/subscriptions/payments pages on the
  new shell) and App Management rebuild: legacy screens still mounted
  unchanged under `/admin/users/*`, `/admin/app/builder`, `/admin/ops/*`,
  `/admin/system/*`.
- Email/SMTP for approval notifications: notifications are in-app only
  (`notificationComposerService.js` stubs).
- Main backend `.env` (main repo checkout, NOT docker) is stale: still
  `DATA_STORE=json`, no DATABASE_URL — non-docker local backend in the
  main checkout will not start until that is fixed like the admin
  worktree's `.env` (DATABASE_URL to 127.0.0.1:5433).
- `main` is ahead of `origin/main`; push when desired.
- Vite port collision: main repo and admin worktree both use 5173
  strictPort; run only one or pass `--port 5174`.

## Verification checklist for the NEXT session to confirm this handoff

```bash
git -C /home/nethunter07/PROJECTS/boe_app log --oneline -7        # d0bcdd9 on top
curl -s http://127.0.0.1:47502/v1/public/landing-config | head -c 200   # version >= 5
curl -s http://127.0.0.1:47502/v1/public/courses | head -c 200          # money-basics
grep -rn 'landing-config' /home/nethunter07/PROJECTS/boe_app-landing/frontend_stack/packages/landing_page/src || echo "consumption not implemented yet"
cd /home/nethunter07/PROJECTS/boe_app/backend_controller && npm run authz:admin-rbac && npm run authz:403
```
