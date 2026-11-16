import type { Transaction } from "../db/repositories.js"

export interface ActiveClientLockRepository {
  lockActive: (tx: Transaction, userId: string) => Promise<boolean>
}

export const createActiveClientLockRepository = (): ActiveClientLockRepository => ({
  lockActive: async (tx, userId) => {
    const row = await tx
      .selectFrom("users")
      .select("id")
      .where("id", "=", userId)
      .where("account_state", "=", "active")
      .where("pii_tombstoned_at", "is", null)
      .forShare()
      .executeTakeFirst()
    return row !== undefined
  },
})
