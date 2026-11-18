import type { Transaction } from "../db/repositories.js"

export interface AdminStepUpBinding {
  readonly userId: string
  readonly sessionId: string
  readonly action: string
}

export interface IssueAdminStepUpInput extends AdminStepUpBinding {
  readonly tokenHash: Buffer
  readonly tokenKeyVersion: string
  readonly requestSha256: Buffer
  readonly expiresAt: Date
  readonly now: Date
}

export interface PresentedAdminStepUp extends AdminStepUpBinding {
  readonly tokenHash: Buffer
}

export interface AdminStepUpState {
  readonly consumedAt: Date | null
  readonly expiresAt: Date
}

export interface AdminStepUpRepository {
  issue: (tx: Transaction, input: IssueAdminStepUpInput) => Promise<string>
  consume: (
    tx: Transaction,
    input: PresentedAdminStepUp & Readonly<{ requestSha256: Buffer; now: Date }>,
  ) => Promise<string | null>
  findBound: (tx: Transaction, input: PresentedAdminStepUp) => Promise<AdminStepUpState | null>
}

export const createAdminStepUpRepository = (): AdminStepUpRepository => ({
  issue: async (tx, input) => {
    const row = await tx
      .insertInto("admin_step_up_confirmations")
      .values({
        user_id: input.userId,
        session_id: input.sessionId,
        action: input.action,
        token_hash: input.tokenHash,
        token_key_version: input.tokenKeyVersion,
        request_sha256: input.requestSha256,
        created_at: input.now,
        expires_at: input.expiresAt,
        consumed_at: null,
      })
      .returning("id")
      .executeTakeFirstOrThrow()
    return row.id
  },

  consume: async (tx, input) => {
    const row = await tx
      .updateTable("admin_step_up_confirmations")
      .set({ consumed_at: input.now })
      .where("token_hash", "=", input.tokenHash)
      .where("user_id", "=", input.userId)
      .where("session_id", "=", input.sessionId)
      .where("action", "=", input.action)
      .where("request_sha256", "=", input.requestSha256)
      .where("consumed_at", "is", null)
      .where("expires_at", ">", input.now)
      .returning("id")
      .executeTakeFirst()
    return row?.id ?? null
  },

  findBound: async (tx, input) => {
    const row = await tx
      .selectFrom("admin_step_up_confirmations")
      .select(["consumed_at", "expires_at"])
      .where("token_hash", "=", input.tokenHash)
      .where("user_id", "=", input.userId)
      .where("session_id", "=", input.sessionId)
      .where("action", "=", input.action)
      .executeTakeFirst()
    return row === undefined ? null : { consumedAt: row.consumed_at, expiresAt: row.expires_at }
  },
})
