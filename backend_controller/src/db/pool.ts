import pg from "pg"

import type { DatabaseConfig } from "./config.js"

/**
 * What the pool needs. The two timeouts are optional so callers that build a
 * config literal (integration tests) keep working; omitting them leaves the
 * PostgreSQL server default in place, and `parseDatabaseConfig` always supplies
 * them for the real runtime.
 */
export type PoolSettings = Omit<
  DatabaseConfig,
  "statementTimeoutMs" | "idleInTransactionTimeoutMs"
> &
  Partial<Pick<DatabaseConfig, "statementTimeoutMs" | "idleInTransactionTimeoutMs">>

/**
 * Pool settings for the schema tools (migrate, seed).
 *
 * Migrations must NOT inherit `statement_timeout`. `runMigrations` sends each
 * `.sql` file as a single multi-statement simple query, and PostgreSQL times such
 * a query as one statement — so the 10 s default would bound an entire migration
 * file, DDL, index builds and backfill together, and a future large backfill would
 * abort mid-release. The idle-in-transaction bound is dropped for the same reason:
 * these scripts hold one deliberate transaction per file.
 */
export const schemaToolPoolSettings = (config: DatabaseConfig): PoolSettings => ({
  connectionString: config.connectionString,
  poolMax: config.poolMax,
  connectionTimeoutMs: config.connectionTimeoutMs,
  idleTimeoutMs: config.idleTimeoutMs,
})

/**
 * Create the PostgreSQL connection pool from typed configuration. The pool is
 * lazy: it does not connect until the first query. The backend owns pool
 * creation, sizing, and shutdown explicitly rather than delegating it to a
 * framework plugin.
 *
 * `statement_timeout` and `idle_in_transaction_session_timeout` are set per
 * connection so a pathological query or an abandoned transaction is cancelled by
 * PostgreSQL rather than holding a pooled connection — and, in the transaction
 * case, its row locks — indefinitely. Both are omitted when 0 or absent, which
 * leaves the server default in place.
 */
export const createPool = (config: PoolSettings): pg.Pool =>
  new pg.Pool({
    connectionString: config.connectionString,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: config.idleTimeoutMs,
    ...(config.statementTimeoutMs !== undefined && config.statementTimeoutMs > 0
      ? { statement_timeout: config.statementTimeoutMs }
      : {}),
    ...(config.idleInTransactionTimeoutMs !== undefined && config.idleInTransactionTimeoutMs > 0
      ? { idle_in_transaction_session_timeout: config.idleInTransactionTimeoutMs }
      : {}),
  })
