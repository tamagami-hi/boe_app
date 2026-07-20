/**
 * Public onboarding routes (spec 04 §3.1). Unauthenticated learner-signup
 * surface: `GET /v1/public/consent-documents` and `POST /v1/applications`.
 * `POST /v1/applications/verify-email` is added in BE-008c.
 */
import { createHash } from "node:crypto"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { CryptoContext } from "../crypto/context.js"
import type { UnitOfWork } from "../db/database.js"
import type {
  ConsentDocument,
  ConsentKind,
  IdempotencyRepository,
  IdempotencyScope,
} from "../db/repositories.js"
import type { Database } from "../db/types.js"
import { AppError } from "../http/errorCatalog.js"
import { executeIdempotent } from "../http/idempotencyProtocol.js"
import { parseOrThrow } from "../http/validation.js"
import type { ApplicationWriteRepository } from "../repositories/applicationRepository.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { ConsentRepositoryImpl } from "../repositories/consentRepository.js"
import type { EmailDeliveryWriteRepository } from "../repositories/emailDeliveryRepository.js"
import type { OutboxWriteRepository } from "../repositories/outboxRepository.js"
import type { VerificationTokenWriteRepository } from "../repositories/verificationTokenRepository.js"
import { submitApplication } from "../domain/onboarding/submitApplication.js"
import { verifyApplicationEmail } from "../domain/onboarding/verifyApplicationEmail.js"

export interface PublicOnboardingConfig {
  readonly verificationTokenTtlMs: number
  readonly idempotencyTtlMs: number
  readonly sesConfigurationSet: string
}

export interface PublicOnboardingDeps {
  readonly database: Kysely<Database>
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly crypto: CryptoContext
  readonly config: PublicOnboardingConfig
  readonly applicationRepository: ApplicationWriteRepository
  readonly consentRepository: ConsentRepositoryImpl
  readonly verificationTokenRepository: VerificationTokenWriteRepository
  readonly emailDeliveryRepository: EmailDeliveryWriteRepository
  readonly outboxRepository: OutboxWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly idempotencyRepository: IdempotencyRepository
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

const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/u)

const consentItemSchema = z
  .object({
    kind: z.enum(["terms", "privacy"]),
    version: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._-]{1,40}$/u),
    accepted: z.literal(true),
  })
  .strict()

const submitApplicationBodySchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .refine((value) => [...value].length >= 2 && [...value].length <= 120, "must be 2 to 120 characters")
      .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value), "must not contain control characters"),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().min(8).max(32),
    consents: z
      .array(consentItemSchema)
      .length(2)
      .refine(
        (items) =>
          items.filter((item) => item.kind === "terms").length === 1 &&
          items.filter((item) => item.kind === "privacy").length === 1,
        "exactly one terms and one privacy consent are required",
      ),
  })
  .strict()

const verifyEmailBodySchema = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) })
  .strict()

const normalizePhone = (raw: string): string => {
  const candidate = raw.replace(/[\s()-]/gu, "")
  if (!/^\+[1-9][0-9]{7,14}$/u.test(candidate)) {
    throw new AppError("VALIDATION_FAILED", { fields: { phone: ["must be a valid E.164 phone number"] } })
  }
  return candidate
}

const requireIdempotencyKey = (request: FastifyRequest): string => {
  const header = request.headers["idempotency-key"]
  const value = Array.isArray(header) ? header[0] : header
  const parsed = idempotencyKeySchema.safeParse(value)
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", { fields: { "idempotency-key": ["a valid Idempotency-Key header is required"] } })
  }
  return parsed.data
}

const hashRequest = (canonical: Readonly<Record<string, unknown>>): Buffer =>
  createHash("sha256").update(JSON.stringify(canonical)).digest()

const handleSubmission = async (
  deps: PublicOnboardingDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> => {
  const idempotencyKey = requireIdempotencyKey(request)
  const body = parseOrThrow(submitApplicationBodySchema, request.body)

  const emailNormalized = body.email.toLowerCase()
  const phoneE164 = normalizePhone(body.phone)
  const consents = body.consents.map((consent) => ({ kind: consent.kind, version: consent.version }))

  const scope: IdempotencyScope = {
    actorScope: "public",
    actorScopeKeyVersion: null,
    candidateActorScopes: ["public"],
    method: "POST",
    routeTemplate: "/v1/applications",
    key: idempotencyKey,
  }
  const requestHash = hashRequest({ fullName: body.fullName, email: emailNormalized, phone: phoneE164, consents })
  const now = deps.clock()

  const outcome = await deps.unitOfWork.execute((tx) =>
    executeIdempotent<{ accepted: true }>({
      repository: deps.idempotencyRepository,
      tx,
      scope,
      requestHash,
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + deps.config.idempotencyTtlMs).toISOString(),
      execute: async () => {
        await submitApplication(
          tx,
          {
            applicationRepository: deps.applicationRepository,
            consentRepository: deps.consentRepository,
            verificationTokenRepository: deps.verificationTokenRepository,
            emailDeliveryRepository: deps.emailDeliveryRepository,
            outboxRepository: deps.outboxRepository,
            auditRepository: deps.auditRepository,
            crypto: deps.crypto,
            clock: deps.clock,
            config: {
              verificationTokenTtlMs: deps.config.verificationTokenTtlMs,
              sesConfigurationSet: deps.config.sesConfigurationSet,
            },
          },
          {
            fullName: body.fullName,
            emailNormalized,
            phoneE164,
            consents,
            requestId: request.requestId,
            clientIp: request.ip,
            userAgent: request.headers["user-agent"] ?? null,
          },
        )
        return { status: 202, body: { accepted: true } }
      },
    }),
  )

  return reply.sendData(outcome.body, {
    status: outcome.status,
    ...(outcome.replay ? { idempotencyReplay: true } : {}),
  })
}

export const registerPublicOnboardingRoutes = (
  application: FastifyInstance,
  deps: PublicOnboardingDeps,
): void => {
  application.get("/v1/public/consent-documents", async (_request, reply) => {
    const documents = await deps.consentRepository.findCurrentDocuments(deps.database, CONSENT_KINDS)
    return reply.sendData({ items: documents.map(toItem) })
  })

  application.post("/v1/applications", async (request, reply) => handleSubmission(deps, request, reply))

  application.post("/v1/applications/verify-email", async (request, reply) => {
    const body = parseOrThrow(verifyEmailBodySchema, request.body)
    await deps.unitOfWork.execute((tx) =>
      verifyApplicationEmail(
        tx,
        {
          applicationRepository: deps.applicationRepository,
          verificationTokenRepository: deps.verificationTokenRepository,
          auditRepository: deps.auditRepository,
          crypto: deps.crypto,
          clock: deps.clock,
        },
        { token: body.token, requestId: request.requestId },
      ),
    )
    return reply.sendData({ verified: true }, { status: 200 })
  })
}
