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
  readonly version: number
}

export interface NomineeReplacement {
  readonly userId: string
  readonly nominee: Nominee | null
  readonly expectedVersion: number
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
  readonly nominee_version: number
}

const HOLDER_COLUMNS = [
  "id",
  "nominee_name",
  "nominee_relation",
  "account_state",
  "pii_tombstoned_at",
  "nominee_version",
] as const

const toHolder = (row: HolderRow): NomineeHolder => ({
  userId: row.id,
  nominee:
    row.nominee_name === null || row.nominee_relation === null
      ? null
      : { name: row.nominee_name, relation: row.nominee_relation },
  accountState: row.account_state,
  tombstoned: row.pii_tombstoned_at !== null,
  version: row.nominee_version,
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
        nominee_version: sql<number>`nominee_version + 1`,
        updated_at: input.now,
      })
      .where("id", "=", input.userId)
      .where("nominee_version", "=", input.expectedVersion)
      .returning(HOLDER_COLUMNS)
      .executeTakeFirst()
    return row === undefined ? null : toHolder(row)
  },
})
