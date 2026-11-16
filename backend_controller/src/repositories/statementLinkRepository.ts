import type { Transaction } from "../db/repositories.js"

export interface IssueStatementLinkInput {
  readonly userId: string
  readonly tokenHash: Buffer
  readonly tokenKeyVersion: string
  readonly fromPeriod: string
  readonly toPeriod: string
  readonly expiresAt: Date
  readonly now: Date
}

export interface ConsumedStatementLink {
  readonly userId: string
  readonly fullName: string
  readonly fromPeriod: string
  readonly toPeriod: string
}

export interface StatementLinkRepository {
  issue: (tx: Transaction, input: IssueStatementLinkInput) => Promise<void>
  consume: (tx: Transaction, input: Readonly<{ tokenHash: Buffer; now: Date }>) => Promise<ConsumedStatementLink | null>
}

export const createStatementLinkRepository = (): StatementLinkRepository => ({
  issue: async (tx, input) => {
    const link = {
      token_hash: input.tokenHash,
      token_key_version: input.tokenKeyVersion,
      from_period: input.fromPeriod,
      to_period: input.toPeriod,
      expires_at: input.expiresAt,
      consumed_at: null,
      created_at: input.now,
    }
    await tx
      .insertInto("client_statement_links")
      .values({ user_id: input.userId, ...link })
      .onConflict((conflict) => conflict.column("user_id").doUpdateSet(link))
      .execute()
  },

  consume: async (tx, input) => {
    const row = await tx
      .updateTable("client_statement_links as l")
      .from("users as u")
      .set({ consumed_at: input.now })
      .whereRef("u.id", "=", "l.user_id")
      .where("u.account_state", "=", "active")
      .where("l.token_hash", "=", input.tokenHash)
      .where("l.consumed_at", "is", null)
      .where("l.expires_at", ">", input.now)
      .returning(["l.user_id", "u.full_name", "l.from_period", "l.to_period"])
      .executeTakeFirst()
    return row === undefined
      ? null
      : { userId: row.user_id, fullName: row.full_name, fromPeriod: row.from_period, toPeriod: row.to_period }
  },
})
