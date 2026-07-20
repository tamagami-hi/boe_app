# Task Log Index

Task logs are append-only execution evidence governed by
[WORKING_MODEL.md](../WORKING_MODEL.md). Create each new log from the phase-log
template before production implementation starts.

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

Completed logs preserve their evidence. Correct factual errors explicitly; do
not rewrite prior RED/GREEN history to match later architecture.

| BE-006 | DONE | [Fastify HTTP boundary primitives](./BE-006-http-boundary-primitives.md) | on `ts-migration/backend` |

| BE-008a | DONE | [Public consent-documents route](./BE-008a-public-consent-documents-route.md) | on `ts-migration/backend` |

| BE-008b-1 | DONE | [Onboarding crypto primitives](./BE-008b1-crypto-primitives.md) | on `ts-migration/backend` |

| BE-008b-2 | DONE | [Application submission route](./BE-008b2-application-submission-route.md) | on `ts-migration/backend` |

| BE-008c | DONE | [Verify-email route + first onboarding JS deletion](./BE-008c-verify-email-route.md) | on `ts-migration/backend` (JS 83 -> 82) |

| BE-009a | DONE | [Argon2id password hasher](./BE-009a-password-hasher.md) | on `ts-migration/backend` (JS 82 -> 81) |

| BE-009b | DONE | [Breached-password check (HIBP)](./BE-009b-breach-check.md) | on `ts-migration/backend` |

| BE-009c | DONE | [ES256 access-token service](./BE-009c-access-token.md) | on `ts-migration/backend` |

| BE-009d | DONE | [Refresh/CSRF session-token primitives](./BE-009d-session-tokens.md) | on `ts-migration/backend` (JS 81 -> 80; closes BE-009) |
