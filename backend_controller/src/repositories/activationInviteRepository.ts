/**
 * Activation invite repository (spec 03 §7, §5 `acceptActivationInvite`). The
 * single-use invite is the activation authority; only its hash is stored.
 */
import type { ActivationInvite, Transaction } from "../db/repositories.js"

export interface ActivationInviteWriteRepository {
  lockByTokenHash: (tx: Transaction, tokenHash: Buffer) => Promise<ActivationInvite | null>
  accept: (tx: Transaction, inviteId: string, now: Date) => Promise<ActivationInvite>
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
  accept: async (tx, inviteId, now) =>
    tx
      .updateTable("activation_invites")
      .set({ state: "accepted", accepted_at: now })
      .where("id", "=", inviteId)
      .where("state", "=", "pending")
      .returningAll()
      .executeTakeFirstOrThrow(),
})
