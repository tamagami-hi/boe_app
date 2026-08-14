/**
 * Public content routes: the regulatory documents the app and site show without a
 * session.
 *
 *   GET /v1/public/disclosures        risk labelling, costs, scheme category
 *   GET /v1/public/investor-charter   rights, responsibilities, contacts
 *   GET /v1/public/grievance          redressal steps, timelines, escalation
 *
 * Each is a published `content_items` row whose `payload` holds the structured
 * document; the app renders it as-is. Serving them from the database rather than
 * bundling them in the APK means a wording or contact change ships without a new
 * release — which matters because these are compliance documents.
 *
 * Unauthenticated by design: an investor must be able to read the escalation path
 * without logging in. Nothing user-specific is exposed and only `published` rows
 * are visible, so admin drafts stay private.
 */
import { CACHE_KEYS, type Cache } from "../cache/cache.js"
import type { FastifyInstance, FastifyReply } from "fastify"

import type { UnitOfWork } from "../db/database.js"
import { AppError } from "../http/errorCatalog.js"
import type {
  ClientAccountRepository,
  ContentDocumentRow,
} from "../repositories/clientAccountRepository.js"

export interface PublicContentDeps {
  readonly clientAccountRepository: ClientAccountRepository
  readonly unitOfWork: UnitOfWork
  readonly cache: Cache
  readonly config: { readonly publicContentTtlMs: number }
}

/** Route path -> content key. */
const DOCUMENTS = {
  "/v1/public/disclosures": "disclosures",
  "/v1/public/investor-charter": "investor-charter",
  "/v1/public/grievance": "grievance-redressal",
} as const

const documentBody = (row: ContentDocumentRow): Record<string, unknown> => {
  const payload = row.payload
  const structured = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {}
  return {
    // The structured payload is the document; title/body/version frame it.
    ...structured,
    title: typeof structured.title === "string" ? structured.title : row.title,
    version: row.version,
    updatedAt: row.publishedAt === null ? null : new Date(row.publishedAt).toISOString(),
  }
}

export const registerPublicContentRoutes = (
  application: FastifyInstance,
  deps: PublicContentDeps,
): void => {
  for (const [route, contentKey] of Object.entries(DOCUMENTS)) {
    application.get(route, async (_request, reply): Promise<FastifyReply> => {
      const document = await deps.cache.readOrLoad(
        CACHE_KEYS.publicContent(contentKey),
        deps.config.publicContentTtlMs,
        () => deps.unitOfWork.execute((tx) => deps.clientAccountRepository.findDocument(tx, contentKey)),
      )
      // An unpublished document is a 404 rather than an empty shell; the client
      // falls back to its bundled copy so the screen is never blank.
      if (document === null) throw new AppError("RESOURCE_NOT_FOUND")
      return reply.sendData(documentBody(document))
    })
  }
}
