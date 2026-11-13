import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"
import type { UserAccountState } from "../db/types.js"

export interface Nominee {
  readonly name: string
  readonly relation: string
}

export interface NomineeHolder {
  readonly userId: string
  readonly nominee: Nominee | null
  readonly accountState: UserAccountState
  readonly tombstoned: boolean
  readonly version: string
}

export interface NomineeReplacement {
  readonly userId: string
  readonly nominee: Nominee | null
  readonly expectedVersion: string
  readonly now: Date
}

export interface UserNomineeRepository {
  find: (db: Transaction, userId: string) => Promise<NomineeHolder | null>
  lock: (tx: Transaction, userId: string) => Promise<NomineeHolder | null>
  replace: (tx: Transaction, input: NomineeReplacement) => Promise<NomineeHolder | null>
}

interface HolderRow {
  readonly id: string
  readonly nominee_name: string | null
  readonly nominee_relation: string | null
  readonly account_state: UserAccountState
  readonly pii_tombstoned_at: Date | null
  readonly version: string
}

const HOLDER_COLUMNS = ["id", "nominee_name", "nominee_relation", "account_state", "pii_tombstoned_at", "version"] as const

const toHolder = (row: HolderRow): NomineeHolder => ({
  userId: row.id,
  nominee:
    row.nominee_name === null || row.nominee_relation === null
      ? null
      : { name: row.nominee_name, relation: row.nominee_relation },
  accountState: row.account_state,
  tombstoned: row.pii_tombstoned_at !== null,
  version: row.version,
})

export const createUserNomineeRepository = (): UserNomineeRepository => ({
  find: async (db, userId) => {
    const row = await db.selectFrom("users").select(HOLDER_COLUMNS).where("id", "=", userId).executeTakeFirst()
    return row === undefined ? null : toHolder(row)
  },

  lock: async (tx, userId) => {
    const row = await tx
      .selectFrom("users")
      .select(HOLDER_COLUMNS)
      .where("id", "=", userId)
      .forUpdate()
      .executeTakeFirst()
    return row === undefined ? null : toHolder(row)
  },

  replace: async (tx, input) => {
    const row = await tx
      .updateTable("users")
      .set({
        nominee_name: input.nominee?.name ?? null,
        nominee_relation: input.nominee?.relation ?? null,
        updated_at: input.now,
        version: sql<string>`version + 1`,
      })
      .where("id", "=", input.userId)
      .where("version", "=", input.expectedVersion)
      .returning(HOLDER_COLUMNS)
      .executeTakeFirst()
    return row === undefined ? null : toHolder(row)
  },
})
