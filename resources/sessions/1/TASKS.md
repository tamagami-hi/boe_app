# TypeScript Replacement And Legacy Deletion Ledger

This ledger is the executable task authority. Status and execution rules come
from [WORKING_MODEL.md](./WORKING_MODEL.md). Counts are authored source only;
generated/vendor output is tracked separately and is never hand-converted.
The exact non-overlapping count partition is in
[inventory/JS_TS_MIGRATION_LEDGER.md](./inventory/JS_TS_MIGRATION_LEDGER.md).

## Current Queue

| Task | Status | Depends on | Packet | Completion/deletion boundary |
|---|---|---|---|---|
| DOC-001 Session working model and reorganization | REVIEW | BE-001 | [Packet](./packets/DOC-001-session-working-model.md) | Migration working model, task ledger, logs/status/templates, repaired links, and Legacy hash guard committed |
| CON-007 Consumer contract/package wiring | BACKLOG | CON-006 | Not instantiated | openapi-fetch client factory + `@beonedge/contracts` `file:` consumption from repository-root contexts; publish generated `paths`/OpenAPI exports |
| BE-003 Runtime configuration closure | BACKLOG | CON-006, BE-002 | Not instantiated | Replace/delete config/shared logger JS; strict startup/observability boundary; decide backend ESLint MJS tooling |

## Completed Foundations

| Task | Status | Commit | Result |
|---|---|---|---|
| PLAN-001 Approved rearchitecture plan | DONE | `ec07d21` | Product, schema, API/security, tooling, phase, and deployment authority |
| CON-001 Scalar contract kernel | DONE | `aa7ce93` | Strict shared scalar schemas |
| CON-002 Error/envelope contract kernel | DONE | `387454e` | Stable errors and response envelopes |
| CON-003 Public onboarding contracts | DONE | `92c509f` | Consent/application/verification operation descriptors |
| CON-004 Native activation contract | DONE | `dedeeb6` | Native-only activation contract |
| CON-005 Native authentication contracts | DONE | `45fc7f7` | Login/refresh/logout contracts |
| BE-001 TypeScript/Fastify liveness runtime | DONE | `9e884ad` | Replaced 164 production JS + 47 test JS lines; emitted-only image and GET-only liveness |
| BE-002 Graceful API lifecycle | DONE | on `dev` | Bounded SIGTERM/SIGINT drain in `runtime/shutdown.ts` wired into `server.ts`; exit 0 clean / 1 timeout; 9 tests; no JS deleted |
| CON-006 Deterministic OpenAPI generator | DONE | on `ts-migration/backend` | Zod->committed OpenAPI 3.1 (`generated/openapi-v1.json`)->`openapi-typescript` types; deterministic + Redocly + staleness gates; shared `ErrorEnvelope` component; headers documented; 100% coverage |
| BE-003 Runtime configuration closure | DONE | on `ts-migration/backend` | Deleted legacy `config/env.js`, `config/dotenv.js`, `shared/logger.js` (superseded by typed `runtime/*`); deletion guard; backend JS 89->86 |
| BE-004 PostgreSQL/Kysely foundation | DONE | on `ts-migration/backend` | Typed pool + Kysely + unit-of-work; Testcontainers integration (query/commit/rollback) green; podman-runtime wrapper for the sandbox; no JS deleted |
| BE-005 Migration/check tooling | DONE | on `ts-migration/backend` | Typed `migrate`/`check-db` commands over the pool; deleted 3 legacy DB scripts (86->83); migration runner unit + integration tested |

## Sequential Phase Gates

Later-phase work cannot become `READY` merely because its local code dependency
exists. The preceding normative phase gate must be `DONE`.

| Gate | Status | Required workstreams |
|---|---|---|
| GATE-02 TypeScript/tooling foundation | BACKLOG | CON-006, CON-007, BE-002, BE-003, LN-000, OPS-001, OPS-003A and all Phase 2 checks in the master plan |
| GATE-03 Canonical identity schema | BACKLOG | GATE-02, BE-004, BE-005, BE-007 plus clean/existing DB, constraint, grant, concurrency, rollback checks |
| GATE-04 First backend vertical slice | BACKLOG | GATE-03, CON-009, BE-006, BE-008, BE-009, BE-010, BE-012, BE-016 and complete security/provider flow tests |
| GATE-05 Surface/Android cutover | BACKLOG | GATE-04, LN-002, required FE/AD auth/application integration, Android secure-session/deep-link/restoration checks |
| GATE-06 Fastify hardening/inventory | BACKLOG | GATE-05, BE-019A and descriptor-to-handler/security-control inventory |
| GATE-07 Catalog/content | BACKLOG | GATE-06, CON-010, BE-013, AD-006 and publication/versioning tests |
| GATE-08 Financial domains | BACKLOG | GATE-07, CON-011, CON-012, BE-014, BE-015, BE-017, BE-018 and finance/provider/concurrency/reconciliation gates |
| GATE-09 TypeScript completion | BACKLOG | GATE-08, BE-019, BE-020, FE-018, AD-008, LN-001, CLEAN-001 and all package coverage/build/E2E gates |
| GATE-10 Clean baseline/release | BACKLOG | GATE-09, CLEAN-002, OPS-002, OPS-003, AND-002 and release/rollback acceptance |

Gate rows are acceptance nodes, not code packets. Their task log records the
aggregate evidence; work from a later phase remains `BACKLOG` until the prior
gate is `DONE`.

## Contract-First Domain Packets

Every canonical HTTP route group updates the shared Zod descriptors, generated
OpenAPI/types, and consumer fixtures before its backend/frontend implementation.

| Task | Status | Depends on | Owns |
|---|---|---|---|
| CON-008 Health/readiness/internal contracts | BACKLOG | CON-006 | Readiness/compatibility descriptors and generation checkpoint |
| CON-009 Admin onboarding/auth/email contracts | BACKLOG | CON-006 | Approval/invite/auth/session/email operation descriptors and fixtures |
| CON-010 Catalog/content contracts | BACKLOG | GATE-06, CON-006 | Funds/NAV/disclosures/content/config descriptors and regenerated clients |
| CON-011 Client finance contracts | BACKLOG | GATE-07, CON-006 | Payment/order/SIP/portfolio/activity descriptors and regenerated clients |
| CON-012 Admin finance/config contracts | BACKLOG | GATE-07, CON-010, CON-011 | Maker-checker/AUM/payment/admin-content descriptors and regenerated clients |

## Backend Replacement Packets

| Task | Status | Depends on | TypeScript result and legacy deletion target |
|---|---|---|---|
| BE-002 Graceful API lifecycle | DONE | BE-001 | Bounded signal drain in `server.ts`/`runtime/shutdown.ts` landed on `dev`; no JS deleted; packet [BE-002](./packets/BE-002-graceful-api-lifecycle.md) |
| BE-003 Runtime configuration closure | DONE | CON-006, BE-002 | Deleted `src/config/*.js` + `src/shared/logger.js`; typed `runtime/*` authoritative; deletion guard; `eslint.config.mjs` classified as tooling exception; broader secret/DB/CORS config deferred to owning batches. Packet [BE-003](./packets/BE-003-runtime-configuration-closure.md) |
| BE-004 PostgreSQL/Kysely foundation | DONE | BE-003, CON-006 (GATE-02 partial, deviation recorded) | Typed `pg` pool + Kysely + unit-of-work transaction + `Database` type; Testcontainers integration proven; no JS deleted (legacy DB files kept to consumer cutover). Packet [BE-004](./packets/BE-004-postgresql-kysely-foundation.md) |
| BE-005 Migration/check tooling | DONE | BE-004 | Emitted TS `migrate`/`check-db` commands over the typed pool; deleted `scripts/migrate.js`, `check-db.js`, `seed-auth.js` (86->83); typed bootstrap seed deferred to BE-007. Packet [BE-005](./packets/BE-005-migration-seed-check-tooling.md) |
| BE-006 HTTP boundary primitives | DONE | GATE-02, CON-006, BE-003 | Typed Fastify boundary in `src/http/{errorCatalog,envelope,validation,idempotencyProtocol,boundary}.ts` wired into `createApplication`: request-id resolution, canonical `{ok,data,error,meta}` envelope + `reply.sendData`, stable ErrorCode catalog + internal->public map, `MAX_JSON_BODY_BYTES`=65536 (413) + media-type (415), Zod `parseOrThrow`, and the pure `executeIdempotent` orchestrator over `IdempotencyRepository`. Unit+inject tests; no JS deleted (legacy `http/*.js` -> BE-019). Packet [BE-006](./packets/BE-006-http-boundary-primitives.md) |
| BE-007 Canonical identity/onboarding schema | DONE (BE-007a-g) | BE-004, BE-005 | Split into child packets, all DONE. **a** (`009` onboarding) + **b** (`010` identity) + **c** (`011` sessions) + **d** (`012` RBAC/audit/idempotency/rate-limit/legal-holds) + **e** (`013` outbox/email delivery) migrations; **f** full Kysely `Database` schema types + §7 repository interface contract; **g** idempotent bootstrap seed (`seedCatalog.ts`/`seed.ts`: roles/permissions catalog + current consent docs). Applied+asserted on PG (integration 15/15). Grants/admin-user bootstrap deferred to BE-009/BE-016 per spec 02 §3.5 |
| BE-008 Public consent/application/verification routes | ACTIVE (BE-008a + BE-008b-1/2 + BE-008c DONE; BE-008b-3 refinement pending) | GATE-03, BE-006, BE-007 | Child packets: **008a** consent-documents; **008b-1** crypto; **008b-2** `POST /v1/applications` submission + 7 repositories + DB idempotency; **008c** `POST /v1/applications/verify-email` (single-use token -> submitted; 409/410/400) + **deleted `website/services/onboardingService.js` (first backend JS deletion, 83 -> 82)** guarded by `legacy-deletion.guard.test.ts`. Integration 24/24. Remaining: **008b-3** cooldown resend + cross-match + race savepoint. `publicRoutes.js` -> BE-013 |
| BE-009 Password/token/session security core | DONE (BE-009a-d; `security/auth.js` -> BE-010) | GATE-03, BE-007, CON-009 | **009a** `passwordHasher.ts` (Argon2id) + deleted `security/passwords.js`. **009b** `breachCheck.ts` (HIBP k-anonymity). **009c** `accessToken.ts` (ES256 jose, kid/iss/aud/typ/skew, 10-min TTL). **009d** `sessionTokens.ts` (opaque refresh/CSRF + keyed hash + constant-time verify) + deleted `security/tokens.js`. Backend JS 82 -> 80. `security/auth.js` (request authn/authz) deleted with its Fastify guard in BE-010 |
| BE-010 Activation and web/native auth routes | ACTIVE (native + web + refresh-rotation + legacy deletion DONE; production wiring + `/csrf` recovery deferred) | GATE-03, CON-009, BE-006, BE-008, BE-009 | Accelerated single task. Native: activation/login/refresh-rotation(30s grace+reuse revoke)/logout + bearer guard. Web: cookie/CSRF login/refresh(rotate refresh+CSRF)/logout + Origin/Sec-Fetch guard. Repositories: user/invite/credential + session (native+web create/rotate/revoke). Critical integration tests (35/35). **Deleted `security/auth.js`+`authService.js`(+signup test)+`authRoutes.js` (JS 80 -> 76).** Deferred: `GET /v1/auth/web/csrf` reload recovery + production `server.ts` route wiring/env composition. [log](./logs/BE-010-auth.md) |
| BE-011 Readiness and compatibility health | DONE | GATE-03, CON-008, BE-004, BE-006 | `src/runtime/health.ts`: `/health/ready` readiness probe (200/503 plain, degraded until DB reachable + emailConfigured, no value leaks) + `/v1/health` success envelope; `/health/live` stays in `application.ts`. **Deleted `shared/services/healthService.js` + `shared/routes/healthRoutes.js` (JS 76 -> 74).** [log](./logs/BE-011-health-readiness.md) |
| BE-012 SES/SNS outbox and delivery worker | DONE (core; concrete AWS adapters deferred to prod wiring) | GATE-03, CON-009, BE-007, BE-009 | Pure `src/email/*` (retry ladder 1m..24h + <=20% deterministic jitter + failure classification; strict SNS/SES schemas; SNS provenance: SSRF cert-URL check, canonical v1/v2, RSA-SHA1/256 verify, cert expiry) unit-tested (57). Worker `domain/email/dispatchDueDeliveries` (recover leases -> claim FOR UPDATE SKIP LOCKED -> commit `sending` -> SES via port -> settle delivered/retry/dead-letter; suppressed/obsolete cancel). SNS ingress `POST /v1/provider-events/aws-sns` (raw text/plain 256KiB, fail-closed 401, dedup by MessageId, evidence + bounce/complaint suppression). Repos: outbox claim/settle + emailDelivery transitions/evidence + providerEvent inbox + suppression. Integration 8/8 (fake SES + fake cert-fetch, no live AWS). **Deletes ZERO legacy JS (purely additive; legacy had no SES/SNS/outbox; payment webhooks are BE-014). JS stays 74.** Deferred: concrete SES v2 sender + SSRF cert-fetch adapters, provider-payload at-rest encryption, subscription bootstrap, retention. [log](./logs/BE-012-outbox-email-worker.md) |
| BE-013 Public disclosures/content/catalog | DONE (scope corrected: deletion-only; content/catalog deferred to a later slice per spec 04) | GATE-06, CON-010, BE-004, BE-006, BE-008 | Spec 04 declares the route inventory exhaustive for the first slice and defers courses/plans/FAQs/general content/disclosures/financial routes to later slices; the only first-slice public content route (`GET /v1/public/consent-documents`) is already served by `routes/publicOnboardingRoutes.ts` (BE-008). So BE-013 retired the dead legacy `website/routes/publicRoutes.js` + `website/services/disclosureService.js` (both already dead: publicRoutes imported only by dead `router.js` and imported the already-deleted `onboardingService.js`; disclosureService imported only by publicRoutes), guarded in `legacy-deletion.guard.test.ts`. **No new schema/routes (building content now would contradict the first-slice spec). Backend JS 74 -> 72.** Canonical content/catalog + its schema are a later-slice task (tracked with GATE-07). [log](./logs/BE-013-public-content-retirement.md) |
| BE-014 Payments/provider/webhooks | DONE (deletion-only; payments/financial deferred to a later slice per spec 04) | GATE-07, CON-011, BE-004, BE-006, BE-009 | Spec 04's first-slice webhook surface is only `POST /v1/provider-events/aws-sns` (SES/SNS email, built in BE-012); payment/mandate provider webhooks and the wider financial domain are deferred to later slices, and the legacy code ran on the retired JSON store + non-canonical tables (payments/mandates/transactions/investmentPlans). Retired dead legacy `shared/routes/webhookRoutes.js`, `shared/services/webhookService.js`, `shared/services/payments/{mockProvider,providerFactory,razorpayProvider}.js` (no TS consumers), guarded in `legacy-deletion.guard.test.ts`. **No new schema/routes. Backend JS 72 -> 67.** Canonical Razorpay provider + idempotent payment/mandate evidence are a later-slice task (GATE-08). [log](./logs/BE-014-payments-webhooks-retirement.md) |
| BE-015 Client investment domain | DONE (deletion-only; client financial domain deferred to a later slice per spec 04) | GATE-07, CON-011, BE-013, BE-014 | Every `/v1/client/*` route (dashboard, portfolio, products, SIPs, orders, payments, mandates, transactions, statements, notifications, KYC, support, withdrawals, redemptions) is financial and absent from spec 04's exhaustive first-slice inventory; the services ran on the retired JSON store. Client first-slice surface is native/web auth (BE-010). Retired dead legacy `client/routes/clientRoutes.js` + all 15 `client/services/*.js` (no TS consumers; `client/` dir removed), guarded in `legacy-deletion.guard.test.ts`. **No new schema/routes. Backend JS 67 -> 51.** Canonical client finance domain + schema are a later-slice task (GATE-08). [log](./logs/BE-015-client-domain-retirement.md) |
| BE-016 Admin identity/compliance domain | DONE (additive build; admin legacy deletion consolidated to BE-017) | GATE-03, CON-009, BE-007, BE-010 | Canonical web-cookie + RBAC admin identity surface (spec §3.2/§4.5): `GET /v1/admin/applications` (queue, authenticated cursor), `GET /v1/admin/applications/:id` (detail + strict-safe delivery page), `POST .../review` (submitted->in_review), `POST .../decision?outcome=` (approve: user+invite+review+audit+activation outbox+delivery; reject: review+audit+rejection outbox+delivery; If-Match + idempotency; no maker-checker per §4.5), `POST /v1/admin/users/:id/activation-invites/resend`, `GET /v1/admin/email-deliveries` (full vs masked projection). New `http/cursor.ts` (HMAC opaque cursor: route+filter+24h expiry) + `domain/admin/adminAccess.ts` (RBAC guard) + `domain/admin/{startApplicationReview,decideApplication,resendActivationInvite}` + repos (application queue/review/decision, applicationReview, invite create/revoke, user createInvited, emailDelivery activation/rejection/adminList). Integration 20 tests (RBAC deny/401, approve/reject side-effects, resend, pagination, detail, full+masked, 404/409/idempotency-replay). **Additive — no legacy deletion (all 11 admin services are imported only by `adminRoutes.js`, BE-017's file; legacy KYC is a deferred domain). JS stays 51.** Deferred: production route/env wiring. [log](./logs/BE-016-admin-identity.md) |
| BE-017 Admin finance/content domain | DONE (deletion-only; admin finance/content deferred to a later slice per spec 04) | GATE-07, CON-012, BE-013..016 | Every `/v1/admin/*` finance/content/compliance route (overview/stats, users/approvals, KYC/risk, products/funds/capital/redemptions, payments/mandates/SIP/reconciliation, app+landing config, notifications, FAQs/courses/plans, support) is deferred to later slices per spec 04; services ran on the retired JSON store. The first-slice admin identity surface is served by `routes/adminIdentityRoutes.ts` (BE-016). Retired dead legacy `admin/routes/adminRoutes.js` + all 11 `admin/services/*.js` (no TS consumers; `admin/` dir removed), guarded in `legacy-deletion.guard.test.ts`. **No new schema/routes. Backend JS 51 -> 39.** Canonical admin finance/content is a later-slice task (GATE-08). [log](./logs/BE-017-admin-finance-retirement.md) |
| BE-018 Remaining shared routes/services/contracts/utils | DONE (deletion-only; deferred content/financial shared closures) | GATE-07, CON-010..012, BE-010..017 | Retired the remaining dead legacy `shared/*` block: `shared/config/tax*`, `shared/contracts/*` (money/receipt/payloads), `shared/routes/*` (constants/index/internal/receipt/timeline), `shared/services/*` (appConfig/landingConfig(+schema)/copyRegistry/fundCatalog/fundClientView/courses/plans/receipt/timeline/placeholder/withReceipt), `shared/utils/istDate` (26 files; `src/shared/` removed). All served deferred content/financial domains on the retired JSON store with no TS consumers; the canonical first-slice surface is `src/routes/*.ts` + `src/runtime`. Guarded in `legacy-deletion.guard.test.ts`. **Backend JS 39 -> 13.** Legacy transport (`http/*.js`, `router.js`) + persistence (`db/{client,pgAdapter,store}.js`) + the 4 legacy `scripts/*.js` -> BE-019. [log](./logs/BE-018-shared-retirement.md) |
| BE-019A Fastify hardening/descriptor inventory | BACKLOG | GATE-05, BE-006, BE-008..016 | Phase-6 security-control and descriptor-to-handler inventory; no legacy fallback |
| BE-019 Final legacy transport/guard deletion | DONE (deletion-only; backend authored JS -> 0) | GATE-08, BE-019A, BE-006..018 | Retired the last legacy scaffolding: `src/http/{errors,idempotency,response,router,validate}.js`, root `src/router.js`, `src/db/{client,pgAdapter,store}.js`, and the four legacy `scripts/{check-admin-rbac-routes,check-auth-403-envelope,print-routes,t11-route-inventory}.js` (13 files; no TS consumers, not wired to package.json/CI). Canonical transport is `src/http/*.ts`, canonical persistence `src/db/*.ts`. Guarded in `legacy-deletion.guard.test.ts`; updated the errorCatalog/idempotencyProtocol basename-collision comments to past tense. **Backend authored JS/JSX 13 -> 0.** [log](./logs/BE-019-transport-persistence-retirement.md) |
| BE-020 Backend zero-JS gate | BACKLOG | BE-003..019 | Automated authored-source scan proves zero backend JS/JSX and zero legacy alias/import references |

## Shared Frontend And App Packets

Current authored backlog: 188 JS/JSX files and 20,480 lines across the Vite app,
admin, client, shared, design-tokens, UI-kits, and `vite.config.js`. Landing is
already authored in TS/TSX but still needs strict-boundary cleanup.

| Task | Status | Depends on | TypeScript/TSX result and deletion target |
|---|---|---|---|
| FE-001 Workspace strict TypeScript/test foundation | BACKLOG | CON-007 | `allowJs:false`, package references, Vitest/component/E2E gates; leave Vite config ownership to FE-018 |
| FE-002 Design-token package cleanup | BACKLOG | FE-001 | Prove the unused two-line JS root export has no consumers, delete it/`.` export, preserve required CSS/assets; do not invent speculative TS tokens |
| FE-003 Shared config/format/risk utilities | BACKLOG | FE-001, FE-002 | Typed pure utilities/config; delete corresponding shared `.js` files |
| FE-004 Shared UI components | BACKLOG | FE-002, FE-003 | Typed accessible components; delete `shared/src/components/*.jsx` |
| FE-005 Shared motion/hooks | BACKLOG | FE-002 | Typed reduced-motion/breakpoint/spring primitives; delete `shared/src/motion/*.{js,jsx}` and hooks JS |
| FE-006 UI-kit package cleanup | BACKLOG | FE-002, FE-004 | Prove no consumers, then delete the five dead `ui-kits/src/*.{js,jsx}` files/package aliases; translate only if a real supported consumer is found |
| FE-007 Client platform/security adapters | BACKLOG | GATE-04, FE-001, CON-007 | Typed Capacitor/browser lifecycle, storage, security, errors; delete client platform JS |
| FE-008 Generated-client service layer | BACKLOG | CON-007, FE-007, BE-008..015 | Generated contract client plus typed adapters; delete `client/src/services/*.js` as each endpoint exists |
| FE-009 Typed client fixtures/math | BACKLOG | FE-001 | Replace eight fixture JS modules plus `chartMath.js` and its JS test with typed factories/implementation/tests |
| FE-010 Client session/auth/app-lock | BACKLOG | FE-007, FE-008 | Typed contexts, `hooks/useAppConfig.js`, secure token lifecycle, app lock/login; delete store/auth/hook JSX/JS closure |
| FE-011 Client layout/components primitives | BACKLOG | FE-004, FE-005, FE-009 | Typed responsive/mobile primitives and `Charts.jsx`; delete client layout/component JSX closure |
| FE-012 Client gates/legal/onboarding pages | BACKLOG | FE-010, FE-011 | Typed splash/login/blocked/approval/legal/onboarding flows; delete matching JSX pages |
| FE-013 Client catalog/investment pages | BACKLOG | FE-008, FE-011, BE-013..015 | Typed explore/fund/order/SIP flows; delete matching JSX pages/utilities |
| FE-014 Client portfolio/activity pages | BACKLOG | FE-008, FE-011, BE-015 | Typed dashboard/portfolio/transactions/statements/withdrawals; delete matching JSX pages |
| FE-015 Client payments/mandates | BACKLOG | FE-008, FE-011, BE-014 | Typed payment/mandate flows and Razorpay adapter; delete matching JSX/JS |
| FE-016 Client profile/security/support/notifications | BACKLOG | FE-008, FE-010, FE-011 | Typed remaining screens and utilities; delete matching JSX/JS |
| FE-017 Client package root | BACKLOG | FE-009..016 | Typed `ClientApp` and exports; delete `ClientApp.jsx` and `index.js` |
| FE-018 Vite/Capacitor app shell/config | BACKLOG | FE-006, FE-017, AD-008 | Typed browser/native roots, errors/loaders/main and Vite config; delete five app `src/*.jsx` files plus `vite.config.js`; convert/classify `scripts/check-android-dist.mjs` |

## Admin Packets

| Task | Status | Depends on | TypeScript/TSX result and deletion target |
|---|---|---|---|
| AD-001 Admin helpers/navigation/data boundary | BACKLOG | FE-001, CON-007 | Typed format/load/nav/hooks; delete admin helper/navigation JS |
| AD-002 Admin components/layout primitives | BACKLOG | FE-002, FE-004 | Typed tables/toasts/shell primitives; delete corresponding JSX and primitive index JS |
| AD-003 Admin auth/session/root shell | BACKLOG | AD-001, AD-002, BE-010 | Typed login/session/shell/pages; delete legacy context/auth/root JSX |
| AD-004 Approval/KYC/user administration | BACKLOG | AD-003, BE-016 | Typed screens and review panel; delete corresponding JSX |
| AD-005 Finance administration | BACKLOG | AD-003, BE-017 | Typed AUM/funds/payments/mandates/SIP/transaction screens; delete corresponding JSX |
| AD-006 Site content administration | BACKLOG | AD-001..003, BE-013, BE-017 | Typed editors/pages/content sections and `AppBuilderScreen.jsx`; delete `features/site/**/*.{js,jsx}` and app-builder legacy source |
| AD-007 Audit/environment/dead legacy routes | BACKLOG | AD-003, BE-017 | Typed supported screens; delete or replace stubs, redirects, `legacyRoutes.jsx`, `legacyTabMap.js` |
| AD-008 Admin package root and zero-JS gate | BACKLOG | AD-004..007 | Typed exports/root and automated zero authored JS/JSX proof for admin |

## Landing, Android, Release, And Final Cleanup

| Task | Status | Depends on | Completion/deletion boundary |
|---|---|---|---|
| LN-000 Landing live/BFF foundation | BACKLOG | CON-007, BE-003 | Phase-2 standalone live route, backend liveness proxy smoke, image build/start; no business cutover |
| LN-001 Landing strict TypeScript boundary | BACKLOG | GATE-08, CON-007 | Keep 55 production TS/TSX files and three tests, `allowJs:false`, decide `next.config.mjs`, pass standalone build |
| LN-002 Application-first landing/BFF | BACKLOG | LN-001, BE-008, BE-010 | Typed server-only backend client/BFF, application and auth flows; remove obsolete signup assumptions |
| OPS-001 Repository-root build graph | BACKLOG | CON-007 | Contracts build before consumers; package-specific locks/contexts remain explicit |
| OPS-003A Phase-2 CI foundation | BACKLOG | CON-007, BE-003, LN-000, OPS-001 | Node 22 contract/backend/landing type/lint/test/coverage/build/generation/source-dist/image smoke gates |
| OPS-002 Docker/release-manager migration | BACKLOG | BE-020, LN-002, OPS-001 | Backend/worker/landing emitted images, readiness, rollback; no source JS copied |
| OPS-003 CI migration/deletion gates | BACKLOG | FE-001, OPS-001 | Per-package type/lint/test/coverage/build, stale generation, forbidden import, zero-JS guards |
| AND-001 Android generated-asset hygiene | BACKLOG | FE-018 | Generated web/Cordova JS is regenerated from TS build and excluded/classified; never hand-converted |
| AND-002 Native security/release integration | BACKLOG | AND-001, BE-010 | Secure storage/App Links/network/backup rules, E2E, signed artifact checks |
| CLEAN-001 Repository authored zero-JS/JSX gate | BACKLOG | BE-020, FE-018, AD-008, LN-002 | Zero authored application JS/JSX outside explicitly approved generated/vendor locations |
| CLEAN-002 Legacy data/schema contraction | BACKLOG | CLEAN-001, all domain packets | Remove JSON parity, duplicate tables/adapters/routes after reference and data proofs; create reviewed clean SQL baseline |
| CLEAN-003 Full release acceptance | BACKLOG | CLEAN-002, OPS-002, OPS-003, AND-002 | All Phase 10 tests, images, APK, rollback rehearsal, security review, and production checklist pass |

## Inventory Rules

- Update counts only from reproducible commands recorded in `status/METRICS.md`.
- A row may be split into smaller packets before becoming `ACTIVE`; preserve the
  parent ID in each child log.
- Do not mark a row `DONE` merely because files were renamed. Its behavior,
  deletion guard, coverage, build, review, log, commit, and push must all pass.
- Never add tasks that edit `resources/sessions/Legacy/**`.
