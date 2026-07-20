/**
 * Email suppression repository (spec 03 §3.3/§7, 04 §6.3). A permanent bounce or
 * a complaint records the recipient's keyed HMAC (never the address) so future
 * sends to that recipient are suppressed. The first suppression for a recipient
 * wins; a later duplicate event is a no-op that preserves the source linkage.
 */
import type { EmailSuppression, Transaction } from "../db/repositories.js"

export interface SuppressInput {
  readonly recipientHmac: Buffer
  readonly suppressionHmacKeyVersion: string
  readonly reason: "bounce" | "complaint"
  readonly sourceEventId: string
}

export interface EmailSuppressionWriteRepository {
  /** Active (not lifted) suppression for a recipient HMAC, or null. */
  findActive: (
    tx: Transaction,
    input: Readonly<{ recipientHmac: Buffer; suppressionHmacKeyVersion: string }>,
  ) => Promise<EmailSuppression | null>
  /** Record a suppression, keeping the earliest one for a recipient. */
  suppress: (tx: Transaction, input: SuppressInput) => Promise<void>
}

export const createEmailSuppressionRepository = (): EmailSuppressionWriteRepository => ({
  findActive: async (tx, input) => {
    const row = await tx
      .selectFrom("email_suppressions")
      .selectAll()
      .where("recipient_hmac", "=", input.recipientHmac)
      .where("suppression_hmac_key_version", "=", input.suppressionHmacKeyVersion)
      .where("lifted_at", "is", null)
      .executeTakeFirst()
    return row ?? null
  },

  suppress: async (tx, input) => {
    await tx
      .insertInto("email_suppressions")
      .values({
        recipient_hmac: input.recipientHmac,
        suppression_hmac_key_version: input.suppressionHmacKeyVersion,
        reason: input.reason,
        source_event_id: input.sourceEventId,
      })
      .onConflict((oc) => oc.columns(["recipient_hmac", "suppression_hmac_key_version"]).doNothing())
      .execute()
  },
})
