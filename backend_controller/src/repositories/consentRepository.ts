/**
 * Consent repository implementation (spec 03 §7, 04 §3.1). The `consent_documents`
 * table is authoritative for consent content, path, digest, and version; the
 * request is only evidence of what the user saw.
 */
import type { ConsentDocument, ConsentKind, Transaction } from "../db/repositories.js"

export interface RecordAcceptancesInput {
  readonly applicationId: string
  readonly consentDocumentIds: readonly string[]
  readonly acceptedAt: Date
  readonly ipHmac: Buffer
  readonly ipHmacKeyVersion: string
  readonly userAgent: string | null
}

export interface ConsentRepositoryImpl {
  findCurrentDocuments: (tx: Transaction, kinds: readonly ConsentKind[]) => Promise<readonly ConsentDocument[]>
  recordAcceptances: (tx: Transaction, input: RecordAcceptancesInput) => Promise<void>
}

export const createConsentRepository = (): ConsentRepositoryImpl => ({
  findCurrentDocuments: async (tx, kinds) =>
    tx
      .selectFrom("consent_documents")
      .selectAll()
      .where("retired_at", "is", null)
      .where("kind", "in", [...kinds])
      .orderBy("kind", "asc")
      .execute(),
  recordAcceptances: async (tx, input) => {
    await tx
      .insertInto("application_consents")
      .values(
        input.consentDocumentIds.map((consentDocumentId) => ({
          application_id: input.applicationId,
          consent_document_id: consentDocumentId,
          accepted_at: input.acceptedAt,
          ip_hmac: input.ipHmac,
          ip_hmac_key_version: input.ipHmacKeyVersion,
          user_agent: input.userAgent,
        })),
      )
      .execute()
  },
})
