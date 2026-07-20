import pg from "pg"

import type { DatabaseConfig } from "./config.js"

/**
 * Create the PostgreSQL connection pool from typed configuration. The pool is
 * lazy: it does not connect until the first query. The backend owns pool
 * creation, sizing, and shutdown explicitly rather than delegating it to a
 * framework plugin.
 */
export const createPool = (config: DatabaseConfig): pg.Pool =>
  new pg.Pool({
    connectionString: config.connectionString,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectionTimeoutMs,
    idleTimeoutMillis: config.idleTimeoutMs,
  })
