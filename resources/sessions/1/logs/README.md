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

Completed logs preserve their evidence. Correct factual errors explicitly; do
not rewrite prior RED/GREEN history to match later architecture.
