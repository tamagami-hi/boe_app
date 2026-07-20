# Plan-Orchestrate Result — Finance Education Landing Page

**Plan**: `resources/sessions/description/finance-education-landing-page.md`
**Lang**: `typescript`
**ECC mode**: `plugin (ecc:)`
**Steps**: 14
**Scope**: all
**Generated**: 2026-06-05

> This document was produced by `/ecc:plan-orchestrate`. It is generative only —
> each command below is a ready-to-paste `/ecc:orchestrate custom` invocation.
> Run them top-to-bottom; each is a sequential chain whose output informs the next.

---

## Business model — two-surface separation

The company is **both** an education platform and an investment platform, but the two are
deliberately kept on **separate surfaces** with different audiences and access rules:

| Surface | Audience | What it does | Investment language? |
|---|---|---|---|
| **Public landing page** (`landing_page`, this plan) | Anyone | Sells finance **courses** + premium news/learning; learner sign-up / sign-in | **Never** — by company policy |
| **Client app** (`client` / `client-platform-*`) | Eligibility-gated users only | Actual investing with the company | Yes — but gated, behind auth |

How the separation works:

- The **landing page is education-only**. It must not mention, advertise, hint at, or instruct
  on investing. Whether/when a user can invest is an **internal company decision**, handled by
  company officials — not surfaced on the public site.
- **Sign-up / Sign-in on the landing page creates a learner account**, not an investment account.
  That same account is also the *gateway*: eligibility is decided internally by admins, and
  selected users are **informed by email** when they get access to the investing app. The landing
  page never states this — it simply offers learner sign-up/sign-in.
- Consequently, the landing-page `Out of scope` guards (no invest/SIP/portfolio/account-opening
  copy) are **not a brand conflict** — they are the correct expression of the company's
  surface-separation policy. The BeOnEdge investment brand constraints in `CLAUDE.md` /
  `frontend_stack/SKILL.md` apply to the **client app** surface, which this plan does not touch.

## Detection notes (Phase 0)

- **ECC mode:** plugin install, namespace `ecc:` (command was `/ecc:plan-orchestrate`; agents register as `ecc:<name>`). `{ORCH_CMD}` = `/ecc:orchestrate`.
- **Lang:** `typescript` (Next.js + workspace `package.json`). Reviewer → `ecc:typescript-reviewer`, build → `ecc:build-error-resolver`.
- **Scope of this plan:** the **public education landing page only**. The investing app and its
  eligibility flow are out of scope here (handled internally / on the client surface).
- The description has no numbered steps, so it was decomposed into implementation units (build request + every content section + legacy-removal + backend wiring).

### Pre-run flags

1. **Folder name vs. convention** — the request specifies `landing_page` (underscore); existing packages use hyphens (`landing-page`, `client-platform-web`). Steps 2–3 use `landing_page` as requested. Change before running Step 2 if hyphen convention is preferred.
2. **Sign-up/Sign-in semantics** — keep the auth links in the nav (Step 4): they create a **learner account** and double as the eligibility gateway. Do **not** label them as opening an investment/brokerage account, and do not describe the eligibility/email flow on the public page — it is internal.
3. **No investment copy is policy, not preference** — the `Out of scope` guards on every step exist because the public surface is education-only by company policy. Downstream agents must not "helpfully" add investing CTAs, returns figures, or portfolio framing.

---

## Steps overview

| # | Title | Tags | Chain |
|---|---|---|---|
| 1 | Architecture & design-system port plan | design, plan | `ecc:planner,ecc:architect` |
| 2 | Scaffold Next.js `landing_page` + port tokens | impl | `ecc:tdd-guide,ecc:typescript-reviewer` |
| 3 | Unlink & delete legacy `website` + `landing-page` | refactor | `ecc:architect,ecc:refactor-cleaner,ecc:typescript-reviewer` |
| 4 | Navigation bar + Hero section | impl | `ecc:tdd-guide,ecc:typescript-reviewer` |
| 5 | Course Catalog section | impl | `ecc:tdd-guide,ecc:typescript-reviewer` |
| 6 | Premium Benefits + Learning Method | impl | `ecc:tdd-guide,ecc:typescript-reviewer` |
| 7 | Financial News + Social Proof | impl | `ecc:tdd-guide,ecc:typescript-reviewer` |
| 8 | Plans / Pricing section | impl | `ecc:tdd-guide,ecc:typescript-reviewer` |
| 9 | Lead-capture form → backend onboarding | impl, security | `ecc:tdd-guide,ecc:typescript-reviewer,ecc:security-reviewer` |
| 10 | Footer + educational disclaimer | impl | `ecc:tdd-guide,ecc:typescript-reviewer` |
| 11 | Messaging-rule / brand compliance audit | review | `ecc:typescript-reviewer,ecc:code-reviewer` |
| 12 | Responsive + subtle motion polish | impl | `ecc:tdd-guide,ecc:typescript-reviewer` |
| 13 | E2E coverage + green production build | test, build | `ecc:tdd-guide,ecc:e2e-runner,ecc:build-error-resolver` |
| 14 | Docs / workspace update | docs | `ecc:doc-updater` |

---

## Step 1 — Architecture & design-system port plan

**Intent**: Plan the Next.js `landing_page` structure, routing, section components, design tokens ported from the optimus reference, and the contract for wiring the lead form to the existing backend.
**Tags**: design, plan
**Chain rationale**: Pure design step — `planner` frames requirements/risks, `architect` produces the structure. No reviewer (no code yet).

```bash
/ecc:orchestrate custom "ecc:planner,ecc:architect" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-1] Design the Next.js landing_page architecture for a finance EDUCATION company selling courses plus premium news, porting layout/design system from resources/reference/optimus-the-ai-platform-to-build-and-ship. Define App Router routes, section components, design tokens, and how the lead form integrates with the existing backend_controller onboarding endpoint. Acceptance: documented component/route map; token and theme plan from the reference; backend integration contract defined. Out of scope: investment/trading/portfolio framing, brokerage account opening."
```

## Step 2 — Scaffold Next.js `landing_page` + port tokens

**Intent**: Create the new Next.js package, wire it into the workspace, and port base layout/typography/color primitives from the reference project.
**Tags**: impl
**Chain rationale**: Implementation gated by `typescript-reviewer` for TS/Next correctness.

```bash
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-2] Scaffold a new Next.js App Router app at frontend_stack/packages/landing_page, wire it into the npm workspace, and port base layout, typography, color tokens, and primitives from resources/reference/optimus-the-ai-platform-to-build-and-ship. Acceptance: next dev and next build run clean; workspace recognizes landing_page; ported tokens render on a placeholder home page. Out of scope: investment-app visuals, trading charts, stock tickers."
```

## Step 3 — Unlink & delete legacy `website` + `landing-page`

**Intent**: Remove the two legacy packages from workspace config/build/imports, then delete the directories.
**Tags**: refactor
**Chain rationale**: `architect` confirms safe removal points, `refactor-cleaner` strips references/dead code, `typescript-reviewer` verifies the build stays green.

```bash
/ecc:orchestrate custom "ecc:architect,ecc:refactor-cleaner,ecc:typescript-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-3] Treat frontend_stack/packages/website and frontend_stack/packages/landing-page as legacy: remove them from workspace config, build scripts, and any imports or route references, then delete both directories. Acceptance: no remaining references to the website or landing-page packages; frontend build passes without them; git shows both folders deleted. Out of scope: editing backend_controller."
```

## Step 4 — Navigation bar + Hero section

**Intent**: Build the nav (Courses, Premium, News, Plans, About, Sign in, Sign up + primary CTA) and the education-focused hero.
**Tags**: impl
**Chain rationale**: impl → `typescript-reviewer` closes the loop.

```bash
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-4] Build the navigation bar (Courses, Premium, News, Plans, About, Sign in, Sign up, primary CTA Start learning) where Sign up and Sign in create/access a learner account (the gateway account, never described as an investment or brokerage account), and the hero section with an education-focused headline, supporting copy, a primary CTA to explore courses and a secondary CTA to premium benefits. Acceptance: responsive nav and hero render; Sign in/Sign up link to the existing auth flow as learner account; copy uses approved education language. Out of scope: SIP or lumpsum copy, invest-now or open-account CTAs, stock-ticker visuals, any mention of investing eligibility or the internal email-approval flow."
```

## Step 5 — Course Catalog section

**Intent**: Render data-driven course cards for the suggested categories.
**Tags**: impl
**Chain rationale**: impl → `typescript-reviewer`.

```bash
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-5] Build the Course Catalog section rendering course cards with name, skill level, duration or format, outcome-oriented description, and an enroll/details CTA, for the suggested categories: Money Basics, Budgeting, Saving and Emergency Planning, Debt and Credit, Tax Basics, Family Financial Planning, Freelancer Money Management, Business Cash Flow, Understanding Financial News, Smart Spending. Acceptance: cards driven by a config module; responsive grid; CTAs wired. Out of scope: investment products or fund listings."
```

## Step 6 — Premium Benefits + Learning Method

**Intent**: Build the membership benefits grid and the 5-step learning method.
**Tags**: impl
**Chain rationale**: impl → `typescript-reviewer`.

```bash
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-6] Build the Premium Benefits section (news briefings, plain-language explainers, newsletters, live Q&A, downloadable templates, trackers, member webinars, certificates, private community, early access) and the Learning Method five-step section. Acceptance: both sections render responsively with clear hierarchy; benefit and step items sourced from config. Out of scope: guaranteed-outcome, returns, or wealth-growth language."
```

## Step 7 — Financial News + Social Proof

**Intent**: Build the jargon-free news feature (sample digest cards) and the trust/social-proof block.
**Tags**: impl
**Chain rationale**: impl → `typescript-reviewer`.

```bash
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-7] Build the Financial News feature section with jargon-free briefings and sample digest cards (Economy in 5 minutes, Tax updates explained, Credit and lending changes, Budget announcements decoded, Personal finance reminders) and the Social Proof section (testimonials, course completion numbers, subscriber count, ratings, instructor credibility). Acceptance: both sections render from config; news framed strictly as education. Out of scope: trading signals, investment recommendations, guaranteed-income or returns claims."
```

## Step 8 — Plans / Pricing section

**Intent**: Build the three education-access tiers with included items and education CTAs.
**Tags**: impl
**Chain rationale**: impl → `typescript-reviewer`.

```bash
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-8] Build the Plans/Pricing section with three tiers: Starter course access, Premium membership, and Complete learning bundle, each listing included items (course access, news briefings, live sessions, templates, certificates, support) with CTAs such as Start learning, Join premium, View plans. Acceptance: three responsive plan cards from config; education CTAs only. Out of scope: invest now, start SIP, buy fund, build portfolio, or open-account CTAs."
```

## Step 9 — Lead-capture form → backend onboarding

**Intent**: Build the course/membership-interest form, validate client-side mirroring backend rules, and POST to the existing backend onboarding endpoint.
**Tags**: impl, security
**Chain rationale**: impl + security (collects PII: email/phone) → `security-reviewer` closes the chain after `typescript-reviewer`.

```bash
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer,ecc:security-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-9] Build the lead-capture form (Name, Email, Phone, Interested course or plan, optional Message) with client validation mirroring the backend rules, submitting to the existing backend_controller onboarding endpoint, framed as course/membership interest with CTA Request course details. Acceptance: validation matches backend; a successful POST persists a lead; idle, submitting, success, and error states are handled; PII handled safely. Out of scope: KYC, account opening, portfolio or investment onboarding framing."
```

## Step 10 — Footer + educational disclaimer

**Intent**: Build the education-positioned footer with the mandatory disclaimer.
**Tags**: impl
**Chain rationale**: impl → `typescript-reviewer`.

```bash
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-10] Build the footer with company name and a short financial-education description, course links, premium membership links, newsletter/news signup, contact email, and Terms/Privacy plus the educational disclaimer that content is for financial education and general awareness only and does not constitute financial, legal, tax, or investment advice. Acceptance: footer responsive; disclaimer present; links resolve. Out of scope: investment-advice or account-opening links."
```

## Step 11 — Messaging-rule / brand compliance audit

**Intent**: Audit the whole page against the doc's messaging rules.
**Tags**: review
**Chain rationale**: review-only; `typescript-reviewer` then generic `code-reviewer` for copy/structure compliance.

```bash
/ecc:orchestrate custom "ecc:typescript-reviewer,ecc:code-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-11] Audit the entire landing_page for messaging-rule compliance: education positioning only; no invest, SIP, buy funds, open account, beat the market, guaranteed returns, portfolio, or trading-signal language; sign-up framed as a learner account; and the educational disclaimer present on money and news copy. Acceptance: zero banned phrases; sign-up copy reads as a learner account; disclaimer verified across sections."
```

## Step 12 — Responsive + subtle motion polish

**Intent**: Add mobile responsiveness and restrained hover/motion states matching the reference's editorial feel.
**Tags**: impl
**Chain rationale**: impl → `typescript-reviewer`.

```bash
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-12] Add strong mobile responsiveness and subtle hover/motion states only where they improve usability across all landing_page sections, matching the premium editorial spacing from the reference project. Acceptance: layouts hold from mobile to desktop breakpoints; motion is subtle and non-distracting; no layout-shift regressions. Out of scope: flashy trading-app animations, neon chart visuals."
```

## Step 13 — E2E coverage + green production build

**Intent**: Cover critical flows end-to-end and ensure the production build passes.
**Tags**: test, build
**Chain rationale**: test primary (`tdd-guide,e2e-runner`) + build secondary (`build-error-resolver`); gated by their own validators, no extra reviewer.

```bash
/ecc:orchestrate custom "ecc:tdd-guide,ecc:e2e-runner,ecc:build-error-resolver" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-13] Add end-to-end coverage for the critical flows (browse courses, view premium, submit the lead form to the backend) and ensure the Next.js production build is green. Acceptance: e2e covers navigation, course catalog, and a successful lead submission; next build passes with no type or build errors."
```

## Step 14 — Docs / workspace update

**Intent**: Update docs to reflect the new package and the removed legacy packages.
**Tags**: docs
**Chain rationale**: docs → `doc-updater`.

```bash
/ecc:orchestrate custom "ecc:doc-updater" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-14] Update documentation for the new landing_page Next.js package and the removal of the legacy website and landing-page packages: README, workspace notes, and any affected route maps under resources/. Acceptance: docs reference landing_page; legacy packages are no longer documented as active; run and build commands are updated."
```

---

## Batch execution

```bash
/ecc:orchestrate custom "ecc:planner,ecc:architect" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-1] Design the Next.js landing_page architecture for a finance EDUCATION company selling courses plus premium news, porting layout/design system from resources/reference/optimus-the-ai-platform-to-build-and-ship. Define App Router routes, section components, design tokens, and how the lead form integrates with the existing backend_controller onboarding endpoint. Acceptance: documented component/route map; token and theme plan from the reference; backend integration contract defined. Out of scope: investment/trading/portfolio framing, brokerage account opening."
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-2] Scaffold a new Next.js App Router app at frontend_stack/packages/landing_page, wire it into the npm workspace, and port base layout, typography, color tokens, and primitives from resources/reference/optimus-the-ai-platform-to-build-and-ship. Acceptance: next dev and next build run clean; workspace recognizes landing_page; ported tokens render on a placeholder home page. Out of scope: investment-app visuals, trading charts, stock tickers."
/ecc:orchestrate custom "ecc:architect,ecc:refactor-cleaner,ecc:typescript-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-3] Treat frontend_stack/packages/website and frontend_stack/packages/landing-page as legacy: remove them from workspace config, build scripts, and any imports or route references, then delete both directories. Acceptance: no remaining references to the website or landing-page packages; frontend build passes without them; git shows both folders deleted. Out of scope: editing backend_controller."
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-4] Build the navigation bar (Courses, Premium, News, Plans, About, Sign in, Sign up, primary CTA Start learning) where Sign up and Sign in create/access a learner account (the gateway account, never described as an investment or brokerage account), and the hero section with an education-focused headline, supporting copy, a primary CTA to explore courses and a secondary CTA to premium benefits. Acceptance: responsive nav and hero render; Sign in/Sign up link to the existing auth flow as learner account; copy uses approved education language. Out of scope: SIP or lumpsum copy, invest-now or open-account CTAs, stock-ticker visuals, any mention of investing eligibility or the internal email-approval flow."
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-5] Build the Course Catalog section rendering course cards with name, skill level, duration or format, outcome-oriented description, and an enroll/details CTA, for the suggested categories: Money Basics, Budgeting, Saving and Emergency Planning, Debt and Credit, Tax Basics, Family Financial Planning, Freelancer Money Management, Business Cash Flow, Understanding Financial News, Smart Spending. Acceptance: cards driven by a config module; responsive grid; CTAs wired. Out of scope: investment products or fund listings."
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-6] Build the Premium Benefits section (news briefings, plain-language explainers, newsletters, live Q&A, downloadable templates, trackers, member webinars, certificates, private community, early access) and the Learning Method five-step section. Acceptance: both sections render responsively with clear hierarchy; benefit and step items sourced from config. Out of scope: guaranteed-outcome, returns, or wealth-growth language."
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-7] Build the Financial News feature section with jargon-free briefings and sample digest cards (Economy in 5 minutes, Tax updates explained, Credit and lending changes, Budget announcements decoded, Personal finance reminders) and the Social Proof section (testimonials, course completion numbers, subscriber count, ratings, instructor credibility). Acceptance: both sections render from config; news framed strictly as education. Out of scope: trading signals, investment recommendations, guaranteed-income or returns claims."
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-8] Build the Plans/Pricing section with three tiers: Starter course access, Premium membership, and Complete learning bundle, each listing included items (course access, news briefings, live sessions, templates, certificates, support) with CTAs such as Start learning, Join premium, View plans. Acceptance: three responsive plan cards from config; education CTAs only. Out of scope: invest now, start SIP, buy fund, build portfolio, or open-account CTAs."
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer,ecc:security-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-9] Build the lead-capture form (Name, Email, Phone, Interested course or plan, optional Message) with client validation mirroring the backend rules, submitting to the existing backend_controller onboarding endpoint, framed as course/membership interest with CTA Request course details. Acceptance: validation matches backend; a successful POST persists a lead; idle, submitting, success, and error states are handled; PII handled safely. Out of scope: KYC, account opening, portfolio or investment onboarding framing."
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-10] Build the footer with company name and a short financial-education description, course links, premium membership links, newsletter/news signup, contact email, and Terms/Privacy plus the educational disclaimer that content is for financial education and general awareness only and does not constitute financial, legal, tax, or investment advice. Acceptance: footer responsive; disclaimer present; links resolve. Out of scope: investment-advice or account-opening links."
/ecc:orchestrate custom "ecc:typescript-reviewer,ecc:code-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-11] Audit the entire landing_page for messaging-rule compliance: education positioning only; no invest, SIP, buy funds, open account, beat the market, guaranteed returns, portfolio, or trading-signal language; sign-up framed as a learner account; and the educational disclaimer present on money and news copy. Acceptance: zero banned phrases; sign-up copy reads as a learner account; disclaimer verified across sections."
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-12] Add strong mobile responsiveness and subtle hover/motion states only where they improve usability across all landing_page sections, matching the premium editorial spacing from the reference project. Acceptance: layouts hold from mobile to desktop breakpoints; motion is subtle and non-distracting; no layout-shift regressions. Out of scope: flashy trading-app animations, neon chart visuals."
/ecc:orchestrate custom "ecc:tdd-guide,ecc:e2e-runner,ecc:build-error-resolver" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-13] Add end-to-end coverage for the critical flows (browse courses, view premium, submit the lead form to the backend) and ensure the Next.js production build is green. Acceptance: e2e covers navigation, course catalog, and a successful lead submission; next build passes with no type or build errors."
/ecc:orchestrate custom "ecc:doc-updater" "[Plan: resources/sessions/description/finance-education-landing-page.md#step-14] Update documentation for the new landing_page Next.js package and the removal of the legacy website and landing-page packages: README, workspace notes, and any affected route maps under resources/. Acceptance: docs reference landing_page; legacy packages are no longer documented as active; run and build commands are updated."
```
