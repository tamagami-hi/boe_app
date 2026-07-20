/**
 * Kysely database type. The canonical first-slice tables (applications, users,
 * sessions, RBAC, audit, idempotency, outbox, email, ...) are introduced
 * additively by their owning schema batch (BE-007+). Until then this type is an
 * intentionally empty table map so the typed pool, transaction context, and raw
 * `sql` execution are available without asserting a schema that does not exist
 * yet. Repositories and per-table row types land with the schema.
 */
export type Database = Readonly<Record<string, never>>
