import { sql } from "kysely"

import type { Transaction } from "./repositories.js"

export type SavepointOutcome<TValue> =
  | { readonly kind: "completed"; readonly value: TValue }
  | { readonly kind: "rolled_back"; readonly error: unknown }

export const withSavepoint = async <TValue>(
  tx: Transaction,
  work: () => Promise<TValue>,
): Promise<SavepointOutcome<TValue>> => {
  await sql`savepoint boe_attempt`.execute(tx)
  try {
    const value = await work()
    await sql`release savepoint boe_attempt`.execute(tx)
    return { kind: "completed", value }
  } catch (error) {
    await sql`rollback to savepoint boe_attempt`.execute(tx)
    return { kind: "rolled_back", error }
  }
}
