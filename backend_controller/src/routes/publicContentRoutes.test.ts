import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, test } from "vitest"

import { createUncachedCache } from "../cache/cache.js"
import type { UnitOfWork } from "../db/database.js"
import type { ClientAccountRepository } from "../repositories/clientAccountRepository.js"
import type { ConsentRepositoryImpl } from "../repositories/consentRepository.js"
import { createApplication } from "../runtime/application.js"
import { registerPublicContentRoutes } from "./publicContentRoutes.js"

let app: FastifyInstance | undefined

const unitOfWork: UnitOfWork = {
  execute: (work) => work({} as never),
}

const buildApp = (documents: readonly Record<string, unknown>[]): FastifyInstance => createApplication({
  logger: false,
  registerRoutes: (instance) => registerPublicContentRoutes(instance, {
    cache: createUncachedCache(),
    config: { publicContentTtlMs: 0 },
    unitOfWork,
    clientAccountRepository: {} as ClientAccountRepository,
    consentRepository: {
      findCurrentDocuments: () => Promise.resolve(documents),
    } as unknown as ConsentRepositoryImpl,
  }),
})

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe("GET /v1/public/consent-documents", () => {
  test("returns the authoritative terms and privacy pair in canonical order", async () => {
    app = buildApp([
      {
        kind: "privacy",
        version: "privacy-v2",
        public_path: "/privacy",
        content_markdown: "Privacy text",
        content_sha256: Buffer.alloc(32, 2),
      },
      {
        kind: "terms",
        version: "terms-v3",
        public_path: "/terms",
        content_markdown: "Terms text",
        content_sha256: Buffer.alloc(32, 1),
      },
    ])

    const response = await app.inject({ method: "GET", url: "/v1/public/consent-documents" })

    expect(response.statusCode).toBe(200)
    const body = response.json<{ data: { items: unknown[] } }>()
    expect(body.data.items).toEqual([
      {
        kind: "terms",
        version: "terms-v3",
        publicPath: "/terms",
        contentMarkdown: "Terms text",
        sha256: "01".repeat(32),
      },
      {
        kind: "privacy",
        version: "privacy-v2",
        publicPath: "/privacy",
        contentMarkdown: "Privacy text",
        sha256: "02".repeat(32),
      },
    ])
  })

  test("fails closed when either required document is missing", async () => {
    app = buildApp([{
      kind: "terms",
      version: "terms-v3",
      public_path: "/terms",
      content_markdown: "Terms text",
      content_sha256: Buffer.alloc(32, 1),
    }])

    const response = await app.inject({ method: "GET", url: "/v1/public/consent-documents" })

    expect(response.statusCode).toBe(503)
    const body = response.json<{ error: { code: string } }>()
    expect(body.error.code).toBe("DEPENDENCY_UNAVAILABLE")
  })

  test("fails closed when two rows do not represent the required pair", async () => {
    const terms = {
      kind: "terms",
      version: "terms-v3",
      public_path: "/terms",
      content_markdown: "Terms text",
      content_sha256: Buffer.alloc(32, 1),
    }
    app = buildApp([terms, { ...terms, version: "terms-v4" }])

    const response = await app.inject({ method: "GET", url: "/v1/public/consent-documents" })

    expect(response.statusCode).toBe(503)
  })
})
