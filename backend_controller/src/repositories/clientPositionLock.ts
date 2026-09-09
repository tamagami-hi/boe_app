import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"

export const lockClientPosition = async (tx: Transaction, userId: string, fundId: string): Promise<void> => {
  await sql`
    select pg_advisory_xact_lock(hashtext('client-growth-position'), hashtext(${userId} || ':' || ${fundId}))
  `.execute(tx)
}
