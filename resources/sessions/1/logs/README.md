# Task Log Index

Task logs are append-only execution evidence governed by
[WORKING_MODEL.md](../WORKING_MODEL.md). Create each new log from the phase-log
template before production implementation starts.

Completed logs preserve their evidence. Correct factual errors explicitly; do
not rewrite prior RED/GREEN history to match later architecture.

| Task | Status | Log | Commit |
|---|---|---|---|
| BE-001 | DONE | [Backend TypeScript runtime reset](./BE-001-backend-runtime-reset.md) | `9e884ad` |
| DOC-001 | REVIEW | [Session working model and reorganization](./DOC-001-session-working-model.md) | Pending containing docs commit |
| BE-002 | DONE | [Graceful API lifecycle](./BE-002-graceful-api-lifecycle.md) | on `ts-migration/backend` |
| CON-006 | DONE | [Deterministic OpenAPI generator](./CON-006-deterministic-openapi-generator.md) | on `ts-migration/backend` |
| BE-003 | DONE | [Runtime configuration closure](./BE-003-runtime-configuration-closure.md) | on `ts-migration/backend` |
| BE-004 | DONE | [PostgreSQL/Kysely foundation](./BE-004-postgresql-kysely-foundation.md) | on `ts-migration/backend` |
| BE-005 | DONE | [Migration/check tooling](./BE-005-migration-seed-check-tooling.md) | on `ts-migration/backend` |
| BE-007a | DONE | [Canonical public-onboarding schema](./BE-007a-canonical-onboarding-schema.md) | on `ts-migration/backend` |
| BE-007b | DONE | [Canonical identity/invite tables](./BE-007b-canonical-identity-tables.md) | on `ts-migration/backend` |
| BE-007c | DONE | [Canonical session tables](./BE-007c-canonical-session-tables.md) | on `ts-migration/backend` |
| BE-007d | DONE | [Canonical RBAC/audit/platform tables](./BE-007d-rbac-audit-platform-tables.md) | on `ts-migration/backend` |
| BE-007e | DONE | [Canonical outbox/email delivery tables](./BE-007e-outbox-email-tables.md) | on `ts-migration/backend` |
| BE-007f | DONE | [Kysely schema types + repository interfaces](./BE-007f-kysely-schema-repository-interfaces.md) | on `ts-migration/backend` |
| BE-007g | DONE | [Typed idempotent bootstrap seed](./BE-007g-bootstrap-seed.md) | on `ts-migration/backend` (closes BE-007) |
| BE-006 | DONE | [Fastify HTTP boundary primitives](./BE-006-http-boundary-primitives.md) | on `ts-migration/backend` |
| BE-008a | DONE | [Public consent-documents route](./BE-008a-public-consent-documents-route.md) | on `ts-migration/backend` |
| BE-008b-1 | DONE | [Onboarding crypto primitives](./BE-008b1-crypto-primitives.md) | on `ts-migration/backend` |
| BE-008b-2 | DONE | [Application submission route](./BE-008b2-application-submission-route.md) | on `ts-migration/backend` |
| BE-008c | DONE | [Verify-email route + first onboarding JS deletion](./BE-008c-verify-email-route.md) | on `ts-migration/backend` (JS 83 -> 82) |
| BE-009a | DONE | [Argon2id password hasher](./BE-009a-password-hasher.md) | on `ts-migration/backend` (JS 82 -> 81) |
| BE-009b | DONE | [Breached-password check (HIBP)](./BE-009b-breach-check.md) | on `ts-migration/backend` |
| BE-009c | DONE | [ES256 access-token service](./BE-009c-access-token.md) | on `ts-migration/backend` |
| BE-009d | DONE | [Refresh/CSRF session-token primitives](./BE-009d-session-tokens.md) | on `ts-migration/backend` (JS 81 -> 80; closes BE-009) |
| BE-010a | DONE | [Auth session + credential repositories](./BE-010a-auth-session-repositories.md) | on `ts-migration/backend` |
| BE-010 | DONE | [Activation + native/web auth](./BE-010-auth.md) | on `ts-migration/backend` (JS 80 -> 76; production wiring + `/csrf` recovery deferred) |
| BE-011 | DONE | [Readiness/compatibility health](./BE-011-health-readiness.md) | on `ts-migration/backend` (JS 76 -> 74) |
| BE-012 | DONE | [SES/SNS outbox delivery worker + signed provider-event ingress](./BE-012-outbox-email-worker.md) | on `ts-migration/backend` (additive; JS stays 74; AWS adapters deferred) |
| BE-013 | DONE (deletion-only) | [Retire legacy public content/catalog](./BE-013-public-content-retirement.md) | on `ts-migration/backend` (JS 74 -> 72; content/catalog deferred to a later slice per spec 04) |
| BE-014 | DONE (deletion-only) | [Retire legacy payment/mandate webhooks + providers](./BE-014-payments-webhooks-retirement.md) | on `ts-migration/backend` (JS 72 -> 67; payments/financial deferred to a later slice per spec 04) |
| BE-015 | DONE (deletion-only) | [Retire legacy client investment domain](./BE-015-client-domain-retirement.md) | on `ts-migration/backend` (JS 67 -> 51; client financial domain deferred to a later slice per spec 04) |
| BE-016 | DONE (additive build) | [Canonical admin identity domain](./BE-016-admin-identity.md) | on `ts-migration/backend` (JS stays 51; admin legacy deletion consolidated to BE-017) |
| BE-017 | DONE (deletion-only) | [Retire legacy admin finance/content domain](./BE-017-admin-finance-retirement.md) | on `ts-migration/backend` (JS 51 -> 39; admin finance/content deferred to a later slice per spec 04) |
| BE-018 | DONE (deletion-only) | [Retire remaining legacy shared block](./BE-018-shared-retirement.md) | on `ts-migration/backend` (JS 39 -> 13; deferred content/financial shared closures on the retired JSON store) |
| BE-019 | DONE (deletion-only) | [Retire legacy transport/persistence/scripts](./BE-019-transport-persistence-retirement.md) | on `ts-migration/backend` (JS 13 -> 0; last legacy scaffolding, no TS consumers) |
| BE-020 | DONE (gate) | [Backend zero-JavaScript gate](./BE-020-zero-js-gate.md) | on `ts-migration/backend` (permanent assertion: 0 authored JS/JSX + 0 legacy alias imports) — backend JS->TS migration complete |
| PROD-001 | DONE | [Backend server composition wiring](./PROD-001-server-composition.md) | on `ts-migration/backend` (canonical routes now serve on a running server; smokes boot the full app) |
| BE-021.1 | DONE | [Later-domain schema increment 1 (compliance/catalog/platform)](./BE-021-later-domain-schema-1.md) | on `ts-migration/backend` (migrations 014-016 validated; investing/payments + types are increment 2) |

| BE-021.2 | DONE | [Later-domain schema increment 2 (investing/ownership + payments)](./BE-021-later-domain-schema-2.md) | on `ts-migration/backend` (migrations 017-018 + Kysely types for all later-domain tables; integration 69 -> 75) |

| BE-022 | DONE | [Web CSRF reload-recovery endpoint](./BE-022-web-csrf-recovery.md) | on `ts-migration/backend` (`GET /v1/auth/web/csrf` access-or-refresh-cookie recovery; integration 75 -> 79) |

| BE-024 | DONE | [Migrate-CLI baseline / legacy 001-008 disposition](./BE-024-migrate-baseline-disposition.md) | on `ts-migration/backend` (archived legacy migrations 001-008 per spec 03 §8; `migrate up` now collision-free on the canonical >=009 baseline; +2 guard tests) |

| RA-B0 | DONE | [Deploy-env boot compatibility (Option 3)](./RA-B0-deploy-boot-compat.md) | on `ts-migration/backend` (backend boots under the release_manager deploy env unedited: CORS_ORIGIN, optional AWS, seed:auth, Dockerfile migrations, keys:generate; integration 84) |

| RA-B | DONE | [Landing signup wiring (both surfaces)](./RA-B-landing-signup-wiring.md) | on `ts-migration/backend` (lead + account forms -> `POST /v1/applications` via Next BFF with consent + idempotency; landing build + 24 tests green) |

| RA-C.1 | DONE | [Admin web-auth wiring](./RA-C-1-admin-web-auth-wiring.md) | on `ts-migration/backend` (admin login/session/logout -> `/v1/auth/web/*` cookie+CSRF via shared authApi; reachability -> `/v1/health`; frontend app build green) |

| RA-C.2 | DONE | [Client native-auth wiring](./RA-C-2-client-native-auth-wiring.md) | on `ts-migration/backend` (client login/refresh/logout -> `/v1/auth/native/*` bearer + rotation + device; signup fails fast per the application model; app build green). Auth complete for both surfaces |

| RA-C.3 | DONE | [Admin applications queue wiring](./RA-C-3-admin-applications-queue-wiring.md) | on `ts-migration/backend` (admin approvals queue + review->decision handshake -> `/v1/admin/applications*` with CSRF/Idempotency-Key/If-Match; app build green) |

| RA-C.4 | DONE | [Client portfolio read slice (eligibility/holdings/orders)](./RA-C-4-client-portfolio-reads-wiring.md) | on `ts-migration/backend` (first canonical `/v1/client/*` reads: `GET /v1/client/{eligibility,holdings,orders}` native-authenticated over BE-021 schema; derived eligibility spec 03 §2.3; client portfolio/orders/eligibility services wired; integration 84 -> 94; app build green) |


## Related notes (Obsidian graph)

- Governed by: [[WORKING_MODEL|Working model]] · Ledger: [[TASKS|Task ledger]]
- Template: [[templates/PHASE_LOG_TEMPLATE|Phase-log template]]
- Deletion history: [[removed/README|Removed-mechanisms index]]
- Home: [[README|Session 1 home]]
