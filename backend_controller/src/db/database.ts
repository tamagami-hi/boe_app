import { Kysely, PostgresDialect } from "kysely"
import type { Pool } from "pg"

import type { Database } from "./types.js"

/**
 * Create the typed Kysely instance over an owned PostgreSQL pool. The instance
 * is lazy; it opens no connection until a query runs.
 */
export const createDatabase = (pool: Pool): Kysely<Database> =>
  new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })

/**
 * A unit of work runs an operation inside a single database transaction that
 * commits on success and rolls back on any thrown error. Application command
 * services own transaction boundaries through this contract; repositories
 * receive the transaction handle and never begin or commit their own.
 */
export interface UnitOfWork {
  execute: <TResult>(
    operation: (transaction: Kysely<Database>) => Promise<TResult>,
  ) => Promise<TResult>
}

export const createUnitOfWork = (database: Kysely<Database>): UnitOfWork => {
  const execute = <TResult>(
    operation: (transaction: Kysely<Database>) => Promise<TResult>,
  ): Promise<TResult> => database.transaction().execute(operation)

  return Object.freeze({ execute })
}
