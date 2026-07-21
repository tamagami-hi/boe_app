/**
 * Activation invite repository (spec 03 §7, §5 `acceptActivationInvite`). The
 * single-use invite is the activation authority; only its hash is stored.
 */
import type { ActivationInvite, Transaction } from "../db/repositories.js"

export interface CreateActivationInviteInput {
  readonly userId: string
  readonly applicationId: string
  readonly tokenHash: Buffer
  readonly tokenKeyVersion: string
  readonly expiresAt: Date
  readonly createdByUserId: string
}

export interface ActivationInviteWriteRepository {
  lockByTokenHash: (tx: Transaction, tokenHash: Buffer) => Promise<ActivationInvite | null>
  accept: (tx: Transaction, inviteId: string, now: Date) => Promise<ActivationInvite>
  create: (tx: Transaction, input: CreateActivationInviteInput) => Promise<ActivationInvite>
  lockPendingByUserId: (tx: Transaction, userId: string) => Promise<ActivationInvite | null>
  revoke: (
    tx: Transaction,
    input: Readonly<{ inviteId: string; reason: string; now: Date }>,
  ) => Promise<ActivationInvite | null>
}

export const createActivationInviteRepository = (): ActivationInviteWriteRepository => ({
  lockByTokenHash: async (tx, tokenHash) => {
    const row = await tx
      .selectFrom("activation_invites")
      .selectAll()
      .where("token_hash", "=", tokenHash)
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  create: async (tx, input) =>
    tx
      .insertInto("activation_invites")
      .values({
        user_id: input.userId,
        application_id: input.applicationId,
        token_hash: input.tokenHash,
        token_key_version: input.tokenKeyVersion,
        expires_at: input.expiresAt,
        created_by_user_id: input.createdByUserId,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),

  lockPendingByUserId: async (tx, userId) => {
    const row = await tx
      .selectFrom("activation_invites")
      .selectAll()
      .where("user_id", "=", userId)
      .where("state", "=", "pending")
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  revoke: async (tx, input) => {
    const row = await tx
      .updateTable("activation_invites")
      .set({ state: "revoked", revoked_at: input.now, revocation_reason: input.reason })
      .where("id", "=", input.inviteId)
      .where("state", "=", "pending")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },
  accept: async (tx, inviteId, now) =>
    tx
      .updateTable("activation_invites")
      .set({ state: "accepted", accepted_at: now })
      .where("id", "=", inviteId)
      .where("state", "=", "pending")
      .returningAll()
      .executeTakeFirstOrThrow(),
})
