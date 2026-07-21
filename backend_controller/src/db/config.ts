import { z } from "zod"

const DEFAULT_POOL_MAX = 10
const DEFAULT_CONNECTION_TIMEOUT_MS = 3_000
const DEFAULT_IDLE_TIMEOUT_MS = 10_000

const DatabaseConfigSchema = z.object({
  DATABASE_URL: z.string().trim().min(1),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(DEFAULT_POOL_MAX),
  DB_CONNECTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_CONNECTION_TIMEOUT_MS),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(DEFAULT_IDLE_TIMEOUT_MS),
})

export type DatabaseConfig = Readonly<{
  connectionString: string
  poolMax: number
  connectionTimeoutMs: number
  idleTimeoutMs: number
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
  })
}
