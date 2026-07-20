/**
 * Public onboarding routes (spec 04 §3.1). Unauthenticated learner-signup
 * surface. This registrar currently owns `GET /v1/public/consent-documents`;
 * `POST /v1/applications` and `POST /v1/applications/verify-email` are added in
 * BE-008b/BE-008c.
 */
import type { FastifyInstance } from "fastify"
import type { Kysely } from "kysely"

import type { ConsentDocument, ConsentKind, ConsentRepository } from "../db/repositories.js"
import type { Database } from "../db/types.js"

export interface PublicOnboardingDeps {
  readonly database: Kysely<Database>
  readonly consentRepository: Pick<ConsentRepository, "findCurrentDocuments">
}

const CONSENT_KINDS: readonly ConsentKind[] = ["terms", "privacy"]

interface ConsentDocumentItem {
  readonly kind: ConsentKind
  readonly version: string
  readonly publicPath: string
  readonly contentMarkdown: string
  readonly sha256: string
}

const toItem = (document: ConsentDocument): ConsentDocumentItem => ({
  kind: document.kind,
  version: document.version,
  publicPath: document.public_path,
  contentMarkdown: document.content_markdown,
  sha256: Buffer.from(document.content_sha256 as unknown as Uint8Array).toString("hex"),
})

export const registerPublicOnboardingRoutes = (
  application: FastifyInstance,
  deps: PublicOnboardingDeps,
): void => {
  application.get("/v1/public/consent-documents", async (_request, reply) => {
    const documents = await deps.consentRepository.findCurrentDocuments(deps.database, CONSENT_KINDS)
    return reply.sendData({ items: documents.map(toItem) })
  })
}
