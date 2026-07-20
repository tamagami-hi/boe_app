/**
 * Verification token repository (spec 03 §7, §1). Persists only the token hash;
 * the raw token is never stored.
 */
import type { Transaction, VerificationToken } from "../db/repositories.js"

export interface CreateVerificationTokenInput {
  readonly applicationId: string
  readonly tokenHash: Buffer
  readonly tokenKeyVersion: string
  readonly expiresAt: Date
}

export interface VerificationTokenWriteRepository {
  create: (tx: Transaction, input: CreateVerificationTokenInput) => Promise<VerificationToken>
}

export const createVerificationTokenRepository = (): VerificationTokenWriteRepository => ({
  create: async (tx, input) =>
    tx
      .insertInto("verification_tokens")
      .values({
        application_id: input.applicationId,
        purpose: "application_email_verification",
        token_hash: input.tokenHash,
        token_key_version: input.tokenKeyVersion,
        expires_at: input.expiresAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
})
