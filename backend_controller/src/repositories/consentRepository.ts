/**
 * Consent repository implementation (spec 03 §7, 04 §3.1). The
 * `consent_documents` table is authoritative for consent content, path, digest,
 * and version. Additional methods (`recordAcceptances`, `findForApplication`)
 * land with the application submission route (BE-008b).
 */
import type { ConsentDocument, ConsentKind, ConsentRepository, Transaction } from "../db/repositories.js"

export type ConsentReadRepository = Pick<ConsentRepository, "findCurrentDocuments">

export const createConsentRepository = (): ConsentReadRepository => ({
  findCurrentDocuments: async (
    tx: Transaction,
    kinds: readonly ConsentKind[],
  ): Promise<readonly ConsentDocument[]> => {
    const rows = await tx
      .selectFrom("consent_documents")
      .selectAll()
      .where("retired_at", "is", null)
      .where("kind", "in", [...kinds])
      .orderBy("kind", "asc")
      .execute()
    return rows
  },
})
