# 02 · Landing-Page Controls (Site Control)

What the admin is meant to publish to the **public landing/marketing site**. All
of it is currently 🔴 BROKEN in HTTP mode (the endpoints do not exist); the admin
UI works only against fixtures.

## Screens

### Page content — `/admin/site/content` → `LandingContentPage`
- **Calls:** `GET /v1/admin/landing-config`, `PATCH /v1/admin/landing-config`
  (via `hooks/useLandingConfig.js`).
- **Shape:** a large sectioned JSON (`hero`, `benefits`, `explore`, `learning`,
  `news`, `socialProof`, `leadForm`, `nav`, `meta`) merged over
  `features/site/landingDefaults.js`; publish creates a new version.
- **Status:** 🔴 BROKEN + **needs modeling**. There is **no canonical
  `landing_config` table** — it was legacy JSON. Two canonical options:
  - model landing marketing sections as **`content_items`** (kind per section, versioned, published), or
  - store the whole sectioned document in **`app_config_versions`** (versioned JSON, one current row) — but the canonical `app_config_versions` payload is restricted to *presentation/feature-flags/min-version/download* and **forbids products/funds/money**, and marketing copy is a stretch of "presentation".
  - **Recommendation:** a dedicated versioned `site_content`/`content_items`
    treatment for marketing sections (decide during the build slice).

### Courses — `/admin/site/courses` → `CoursesPage` (+ `CourseEditorDrawer`)
- **Calls:** `GET/POST /v1/admin/courses`, `PATCH/DELETE /v1/admin/courses/:id`.
- **Canonical schema:** `courses` (migration 016) — normalized slug, versioned,
  `price_paise`, `duration_minutes`, `state draft|published|archived`,
  published rows immutable.
- **Status:** 🔴 BROKEN (schema exists, routes missing → buildable).

### Plans — `/admin/site/plans` → `PlansPage` (+ `PlanEditorDrawer`)
- **Calls:** `GET/POST /v1/admin/plans`, `PATCH/DELETE /v1/admin/plans/:id`.
- **Canonical schema:** `membership_plans` (016) — code, versioned,
  `price_paise`, `billing_period_months`, `state`, published immutable.
  (Renamed from legacy `plans` to avoid SIP-plan collision.)
- **Status:** 🔴 BROKEN (buildable).

### FAQs — `/admin/site/faqs` → `FaqsPage` (+ `FaqEditorDrawer`)
- **Calls:** `GET/POST /v1/admin/faqs`, `PATCH/DELETE /v1/admin/faqs/:id`.
- **Canonical schema:** FAQs are **`content_items` with `kind='faq'`** (016) —
  there is intentionally no `faqs` table (spec 03 §8). Versioned, one published
  version per `content_key`.
- **Status:** 🔴 BROKEN (buildable, but must target `content_items`, not a `faqs` table).

## Downstream dependency
The public landing app (`packages/landing_page`, Next.js) must *consume* the
published content once these endpoints exist (courses/plans/faqs/marketing
sections). Wiring the landing to read canonical published content is a related
follow-up (its own slice), tracked separately from building the admin publish
routes.

## Build note
Courses / plans / FAQs are clean CRUD-over-versioned-content and are the
lowest-risk landing slice. Landing "page content" needs a modeling decision first.
See [[05-backend-gaps-and-build-plan]].
