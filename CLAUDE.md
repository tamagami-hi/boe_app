# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Binding rulebook

Read root `README.md`, then root [RULES.md](RULES.md), completely before repository
work and after compaction. `RULES.md` is the sole rules/process authority; this
file is a current-state and architecture map, not a second rulebook.

## Where the project stands

State is not kept here. Read it where it lives:

- **Version:** `VERSION`. Never infer the deployed VPS version from the repository.
- **Progress, decisions and questions:** tally, in `docs/records/`, read through the tally MCP tools:
  - phases and milestones (`board_get` with `rows: "open"`, and the dashboard's Done view);
  - decisions `DEC-n` (`decision_list`) and questions `Q-n` (`question_list`);
  - reviews, handoffs and run evidence.

  tally `convention-9` says where each kind of record goes.
- **Plan:** the active plan is [plans/admin-improvements.md](plans/admin-improvements.md): Phase I and the UI overhaul. Releases are cut from `main` by the maintainer.
- **Standing constraints**, also tally rules `rule-16` to `rule-18`:
  - `RULES.md` is the rulebook;
  - the application is in production, and rule 11 is the data and compatibility policy;
  - payments and AutoPay stay disabled until the maintainer resumes them (DEC-22, DEC-14);
  - no bank details, payment instructions or reference numbers anywhere (DEC-25, DEC-13).
- **How work runs:**
  - lanes run on tally tracks with worktrees under `.temp/worktrees/`, and land through the tally landing queue;
  - checks run in `tools/node22-container/run.sh`;
  - commits are authored as `tamagami-hi` from the global Git config.

## What this is

BeOnEdge (BOE) — an Indian platform with **two deliberately separated surfaces**:

- **Public education website** — a separate application hosted on AWS at `beonedge.in`. Signup reaches public `/api/newuser`, proxied to backend `POST /newuser`, and creates a submitted application rather than an immediate sign-in account.
- **Gated investing app** — client/admin browser and APK surfaces behind auth. Admin approval creates an active account with the signup password; admin-created clients instead choose a password from an emailed link. Email verification gates investing.

This repository is the second surface only: client app + admin panel + backend. Keep the
boundary in mind when editing client-facing copy: the internal eligibility/email flow is
never described publicly.

## Repository layout

Three independent units, no single root build:

- `backend_controller/` — Node.js 22 ESM HTTP API. Fastify, Kysely over `pg`, Zod. No payment-provider SDK, and no direct PhonePe egress either: outbound calls go to an out-of-repo payment service through `providers/relay/`, and only the inbound webhook verifier (`providers/phonepe/phonePeCallbackVerifier.ts`) remains PhonePe-specific. Own `package.json` and `.env`.
- `frontend_stack_ts/` — the single frontend: Vite 6 + React 19 + TypeScript + Capacitor 8, one source tree serving both surfaces. `VITE_BEO_APP_TARGET` picks `client` or `admin` at build time; there is no runtime switch and no second app. There is no marketing-site package here: `beonedge.in` is a separate application on separate infrastructure (AWS) that posts signups to `POST /newuser`.
- `packages/contracts/` — `@beonedge/contracts`: Zod operation descriptors, generated OpenAPI, and the frontend's generated operation exports. Backend routes currently declare validation separately, so API changes must coordinate both surfaces.
- `plans/` — current proposals, decisions, approval gates, and handoffs.
- `release_manager/docs/` — implementation and operational records; `Completed/` is historical evidence.
- `.resources.legacy.TLDR/` — historical archive, not current implementation authority. No root `resources/` or its legacy coordination scripts are available.
- Project-root `package.json` contains Playwright and onboarding-harness scripts; there is no root build or Kimi script suite in the current manifest.

## Common commands

Backend (from `backend_controller/`):

```bash
npm run dev                # tsx --watch src/server.ts
npm run check              # typecheck, lint, coverage, build, source + dist smoke
npm run migrate:dev        # apply db/migrations/*.sql
npm run seed:dev           # catalogue + content seed
npm run seed:auth:dev      # seed admin + client logins
npm run check:db           # verify the Postgres connection (no migrate)
npm run keys:generate      # generate the ES256 / HMAC deploy secrets
npm run test:integration   # testcontainers; needs a container runtime
# Workers, one process each; the :dev variants run through tsx:
npm run worker:payments:dev | worker:email:dev | worker:sips:dev | worker:collections:dev
```

Frontend (from `frontend_stack_ts/`):

```bash
npm run dev            # client SPA on port 5174
npm run dev:admin      # admin SPA on port 5175
npm run check          # typecheck, lint, tests, generated-client drift, build
npm run build:client   # plus the Android dist budget and boot check
npm run build:admin
npm run android:apk    # sync and assemble the client debug APK
```

There is no root compose file. A local stack comes from `test_e2e/local-stack.sh`; deployed stacks come from `release_manager/stacks/<stack>/`.

There is **no repo-wide test runner**: each unit has its own `npm run check`. Tests are colocated `*.test.ts` run by Vitest. The invariant guards are themselves tests — `investment-architecture.guard.test.ts`, `runtime-dependency.guard.test.ts`, `runtime-boundary.test.ts`, `legacy-deletion.guard.test.ts`, `zero-legacy-js.guard.test.ts` and `domain/auth/scopeIsolation.test.ts` — so they run with the suite rather than as separate scripts.

## Backend architecture

Entry: `backend_controller/src/server.ts` — **Fastify**. `src/runtime/composition.ts` is the
composition root: it parses configuration, builds repositories/gateways, and registers
route modules plus health. Some provider registrations are config-gated; inspect the
current wiring rather than assuming every route is mounted. Layers under `src/`:

- `runtime/` — `environment.ts` (two Zod schemas, fail-fast), `composition.ts`, `application.ts`, `health.ts`, `metrics.ts`, `logger.ts`, `shutdown.ts`.
- `http/` — generic plumbing: `boundary.ts`, `envelope.ts`, `errorCatalog.ts`, `validation.ts`, `pagination.ts` + `cursor.ts` (filter-bound keyset cursors), `idempotencyProtocol.ts`, `cors.ts`, `rateLimit.ts` (in-process, per-process).
- `db/` — `types.ts` is the Kysely schema; `repositories.ts` holds only row-type aliases and the idempotency port. Concrete repositories live in `src/repositories/*.ts`, each declaring its own interface. Migrations are plain SQL in `db/migrations/`, applied by `src/scripts/migrate.ts`. **Postgres is the only supported data store.**
- `routes/` — one module per surface, all registered from `composition.ts`. `adminRouteKit.ts` and `fundProjection.ts` are shared helpers, not routes.
- `domain/` — business rules under `payments/`, `client/`, `admin/`, `auth/`, `email/`, `onboarding/`, and `shared/`. Cookie/bearer authentication spans the four isolated channels `native`, `client_web`, `web`, and `admin_native`.
- `providers/` — `paymentGateway.ts` and `recurringPaymentGateway.ts` are ports with a single implementation each under `relay/`, which speaks to an out-of-repo payment service. `phonepe/phonePeCallbackVerifier.ts` authenticates inbound webhooks.
- Four worker entrypoints at the top of `src/`: payment reconciliation (a long-lived loop that also drives the mandate reconciliation pass), email, SIP schedule, mandate collection.

Money never crosses the wire as a float: amounts are integer paise strings. Settlement is
server-authoritative — a provider callback is authenticated, deduplicated, then **discarded
as evidence**, and the truth is re-read from the gateway and applied in
`domain/payments/applyCanonicalPaymentOutcome.ts`.

Investor balances derive from the append-only value ledger in
`domain/client/portfolioLedger.ts`. Earlier principal uses
`domain/admin/recordContribution.ts`, not a growth adjustment.

Mail is queued, never sent inline: `domain/email/enqueueEmail.ts` writes the outbox
event and delivery in the caller's transaction, secrets and names go in an
encrypted sealed payload, and the email worker re-checks each message with a
per-template send guard (password links, email-change codes, admin messages)
before sending. Password links are bound to `users.email_revision` and the
credential version. Admin templates (`email_templates`, immutable
`email_template_revisions`) are plain subject and body with two placeholders;
every admin send is recorded in `admin_email_messages` against its version.

## Frontend architecture

`frontend_stack_ts` is the single Vite/Capacitor host; the surface is chosen by `VITE_BEO_APP_TARGET` at build time. `src/shells/{client,admin}` are the two entry shells over one `src/app` router, one `src/api` transport and one `src/ui` design layer. Server state is TanStack Query keyed by `src/api/queryKeys.ts`; routing is React Router 7 driven by the declarative manifests in `src/app/routing`. Capacitor wraps a build into the APK. This stack is client app + admin panel only; the public marketing site lives outside the repo on AWS.

The design system lives in `frontend_stack_ts/src/ui` — `tokens/` for the CSS custom properties, `primitives/` and `patterns/` for components, and `recipes/` for the typed class-string layer. Styling is Tailwind v4 utilities generated from the token layer via `@theme inline` (D-033); there are no CSS Modules. `tokens/tokens-core.css` is the sole reader of `env(safe-area-inset-*)`. When building UI, compose the existing primitives and recipes rather than restyling from tokens directly, and never import from `features/`, `shells/` or `app/` inside `ui/`; the lint rules enforce that boundary.

Brand, copy, monetary presentation, accessibility, and design-boundary policy are
defined in [RULES.md](RULES.md#product-copy-and-accessibility).

## Environment & operating notes

- One `.env` per unit that needs it: `backend_controller/.env` for local development (`.env.example` beside it), and one `.env` per deployed stack under `release_manager/stacks/<stack>/`, created on the VPS and never overwritten by a deploy. There is no root `.env`. Local defaults: backend `127.0.0.1:47502`. Production safety: `SEED_AUTH_ALLOW_PRODUCTION=false`, real ES256 keys required — `ACCESS_TOKEN_SIGNING_KEY`, `ACCESS_TOKEN_VERIFICATION_KEYS`, `REFRESH_HMAC_KEY` (the validator refuses placeholders on `NODE_ENV=production`). Seeds refuse to overwrite users unless `SEED_AUTH_OVERWRITE=true`.
- Current configuration authority is `backend_controller/src/runtime/environment.ts` plus tracked per-unit/stack env examples. Routes/contracts and source determine the live API shape; `DEPLOY.md` documents the proxy/deployment contract.

## Task map

| Task | Context |
| --- | --- |
| Rules, safety, context, Git, verification | Root `RULES.md` |
| Current requested features and approval | `plans/admin-improvements.md` (previous: `plans/app-onboarding-contact-investment-email.md`) |
| Account creation/password links | `src/domain/admin/createClientAccount.ts`, `src/domain/auth/passwordCredential.ts`, onboarding/password routes |
| Client contacts and verification | Client auth/email-verification domain, user/verification repositories, frontend profile feature |
| Earlier principal and growth | `src/domain/admin/recordContribution.ts`, client-growth domain/repositories, frontend admin client-values feature |
| Email rendering/delivery | Backend `src/email/`, `src/domain/email/`, outbox/delivery repositories, frontend admin emails feature |
| Admin email templates and sends | `src/domain/admin/emailTemplates.ts`, `src/domain/admin/adminEmailMessages.ts`, `src/domain/email/adminMessageGuard.ts`, frontend `features/admin/emails/` |
| API changes | Backend route validation, `packages/contracts/src/operations/`, frontend generated operation exports |
| UI changes | Frontend routing manifests, the owning feature, and existing `src/ui/` primitives/recipes |
| Operator workflows | Root `WORKFLOW.md`, `DEPLOY.md`, `release_manager/README.md` |

Backend-relative `src/` paths in this table refer to `backend_controller/`.
Use existing approved workspace/file ownership when delegation is authorized.
Do not run absent coordination scripts or create a parallel agent team by default.
