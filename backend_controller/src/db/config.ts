import { z } from "zod"

const DEFAULT_POOL_MAX = 10
const DEFAULT_CONNECTION_TIMEOUT_MS = 3_000
const DEFAULT_IDLE_TIMEOUT_MS = 10_000
/**
 * Server-side query and transaction bounds.
 *
 * Nothing used to bound either one. A query that hung held its pooled connection
 * indefinitely, and with `DB_POOL_MAX` at 10 a handful of stuck requests could
 * starve every other caller — including sign-in, which then failed on
 * `connectionTimeoutMillis` rather than on anything diagnosable. These make the
 * database itself cancel the outlier instead of letting it consume a connection
 * forever.
 *
 * `statement_timeout` is deliberately well above normal latency (the slowest
 * expected statements are admin keyset lists) so it only ever fires on a genuine
 * pathology. `idle_in_transaction_session_timeout` is the guard against a
 * transaction left open by a crashed or wedged handler, which would otherwise
 * hold its row locks indefinitely.
 */
const DEFAULT_STATEMENT_TIMEOUT_MS = 10_000
const DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS = 15_000

const DatabaseConfigSchema = z.object({
  DATABASE_URL: z.string().trim().min(1),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(DEFAULT_POOL_MAX),
  DB_CONNECTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_CONNECTION_TIMEOUT_MS),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(DEFAULT_IDLE_TIMEOUT_MS),
  // 0 disables, matching PostgreSQL's own semantics for both settings.
  DB_STATEMENT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(0)
    .default(DEFAULT_STATEMENT_TIMEOUT_MS),
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(0)
    .default(DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS),
})

export type DatabaseConfig = Readonly<{
  connectionString: string
  poolMax: number
  connectionTimeoutMs: number
  idleTimeoutMs: number
  statementTimeoutMs: number
  idleInTransactionTimeoutMs: number
}>

/**
 * Parse the typed database configuration from an environment source. Only the
 * connection string is required; pool sizing and timeouts have bounded typed
 * defaults. Secrets/keyring configuration is owned by the security batch.
 */
export const parseDatabaseConfig = (
  source: Readonly<Record<string, string | undefined>>,
): DatabaseConfig => {
  const parsed = DatabaseConfigSchema.parse(source)

  return Object.freeze({
    connectionString: parsed.DATABASE_URL,
    poolMax: parsed.DB_POOL_MAX,
    connectionTimeoutMs: parsed.DB_CONNECTION_TIMEOUT_MS,
    idleTimeoutMs: parsed.DB_IDLE_TIMEOUT_MS,
    statementTimeoutMs: parsed.DB_STATEMENT_TIMEOUT_MS,
    idleInTransactionTimeoutMs: parsed.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  })
}
