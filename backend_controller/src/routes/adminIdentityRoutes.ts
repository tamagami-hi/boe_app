/**
 * Admin identity/compliance routes (spec 04 §3.2). Web-cookie transport with
 * RBAC permission checks (§4.5); unsafe methods additionally require the
 * synchronizer CSRF token and an Idempotency-Key. List endpoints use the
 * authenticated opaque cursor. The review/decision/resend mutations run under
 * the database idempotency protocol so a replay returns the first committed
 * result.
 */
import { createHash } from "node:crypto"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { CryptoContext } from "../crypto/context.js"
import type { UnitOfWork } from "../db/database.js"
import type { Application, EmailDelivery, IdempotencyRepository, IdempotencyScope } from "../db/repositories.js"
import type { Database } from "../db/types.js"
import type { ApplicationState } from "../db/types.js"
import { resolveAdminPrincipal, requireAnyPermission, hasPermission } from "../domain/admin/adminAccess.js"
import { decideApplication } from "../domain/admin/decideApplication.js"
import { resendActivationInvite } from "../domain/admin/resendActivationInvite.js"
import { startApplicationReview } from "../domain/admin/startApplicationReview.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { computeFilterHash, decodeCursor, encodeCursor } from "../http/cursor.js"
import type { PageMeta } from "../http/envelope.js"
import { AppError } from "../http/errorCatalog.js"
import { executeIdempotent, idempotencyKeySchema } from "../http/idempotencyProtocol.js"
import { parseOrThrow } from "../http/validation.js"
import type { ApplicationWriteRepository } from "../repositories/applicationRepository.js"
import type { ApplicationReviewWriteRepository } from "../repositories/applicationReviewRepository.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { EmailDeliveryWriteRepository } from "../repositories/emailDeliveryRepository.js"
import type { OutboxWriteRepository } from "../repositories/outboxRepository.js"
import type { UserWriteRepository } from "../repositories/userRepository.js"
import type { ActivationInviteWriteRepository } from "../repositories/activationInviteRepository.js"

export interface AdminIdentityConfig {
  readonly cursorKey: Buffer
  readonly idempotencyTtlMs: number
  readonly activationInviteTtlMs: number
  readonly sesConfigurationSet: string
}

export interface AdminIdentityDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly crypto: CryptoContext
  readonly config: AdminIdentityConfig
  readonly applicationRepository: ApplicationWriteRepository
  readonly applicationReviewRepository: ApplicationReviewWriteRepository
  readonly userRepository: UserWriteRepository
  readonly activationInviteRepository: ActivationInviteWriteRepository
  readonly outboxRepository: OutboxWriteRepository
  readonly emailDeliveryRepository: EmailDeliveryWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly idempotencyRepository: IdempotencyRepository
}

const APPLICATIONS_ROUTE = "/v1/admin/applications"
const EMAIL_DELIVERIES_ROUTE = "/v1/admin/email-deliveries"
const MAX_QUEUE_INTERVAL_MS = 366 * 24 * 60 * 60 * 1000
const WIRE_STATES: readonly ApplicationState[] = [
  "submitted",
  "in_review",
  "approved",
  "rejected",
  "withdrawn",
]

const iso = (value: Date | string): string => new Date(value).toISOString()
const versionNumber = (value: unknown): number => Number(value)

// --- validation schemas ---

const statusEnum = z.enum(["submitted", "in_review", "approved", "rejected", "withdrawn"])
const deliveryStateEnum = z.enum([
  "queued",
  "sending",
  "sent",
  "delivered",
  "retryable_failed",
  "permanent_failed",
  "cancelled",
])
const templateKeyEnum = z.enum(["verify_email", "activation_invite", "application_rejected"])
const reasonCodeSchema = z.string().trim().min(1).max(80)
const reasonDetailSchema = z.string().trim().min(1).max(2000)
const limitSchema = z.coerce.number().int().min(1).max(100).default(25)

const applicationsQuerySchema = z
  .object({
    status: statusEnum.optional(),
    createdFrom: z.string().datetime({ offset: true }).optional(),
    createdTo: z.string().datetime({ offset: true }).optional(),
    after: z.string().min(1).optional(),
    limit: limitSchema,
  })
  .strict()

const applicationDetailQuerySchema = z
  .object({ deliveryAfter: z.string().min(1).optional(), deliveryLimit: limitSchema })
  .strict()

const emailDeliveriesQuerySchema = z
  .object({
    state: deliveryStateEnum.optional(),
    templateKey: templateKeyEnum.optional(),
    applicationId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    after: z.string().min(1).optional(),
    limit: limitSchema,
  })
  .strict()

const reviewBodySchema = z.object({ expectedVersion: z.number().int().positive() }).strict()
const decisionBodySchema = z
  .object({ reasonCode: reasonCodeSchema, reasonDetail: reasonDetailSchema.optional() })
  .strict()
const decisionQuerySchema = z.object({ outcome: z.enum(["approved", "rejected"]) }).strict()
const resendBodySchema = z
  .object({
    reasonCode: reasonCodeSchema,
    reasonDetail: reasonDetailSchema.optional(),
    expectedInviteId: z.string().uuid(),
  })
  .strict()
const uuidParam = z.string().uuid()

// --- helpers ---

const requireIdempotencyKey = (request: FastifyRequest): string => {
  const header = request.headers["idempotency-key"]
  const value = Array.isArray(header) ? header[0] : header
  const parsed = idempotencyKeySchema.safeParse(value)
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { "idempotency-key": ["a valid Idempotency-Key header is required"] },
    })
  }
  return parsed.data
}

const parseIfMatchVersion = (request: FastifyRequest): number => {
  const value = request.headers["if-match"]
  const match = typeof value === "string" ? /^"?(\d+)"?$/u.exec(value.trim()) : null
  const captured = match?.[1]
  if (captured === undefined) {
    throw new AppError("VALIDATION_FAILED", { fields: { "if-match": ["a quoted integer version is required"] } })
  }
  return Number(captured)
}

const hashRequest = (canonical: Readonly<Record<string, unknown>>): Buffer =>
  createHash("sha256").update(JSON.stringify(canonical)).digest()

interface KeysetPosition {
  readonly afterCreatedAt?: Date
  readonly afterId?: string
}

const readKeyset = (
  deps: AdminIdentityDeps,
  after: string | undefined,
  route: string,
  filterHash: string,
  now: Date,
): KeysetPosition => {
  if (after === undefined) return {}
  const parts = decodeCursor(deps.config.cursorKey, after, { route, filterHash, now })
  const createdAtRaw = parts[0]
  const idRaw = parts[1]
  if (createdAtRaw === undefined || idRaw === undefined) throw new AppError("CURSOR_INVALID")
  return { afterCreatedAt: new Date(createdAtRaw), afterId: idRaw }
}

interface Paginated<Row> {
  readonly items: readonly Row[]
  readonly page: PageMeta
}

const paginate = <Row>(
  deps: AdminIdentityDeps,
  rows: readonly Row[],
  limit: number,
  route: string,
  filterHash: string,
  now: Date,
  sortValues: (row: Row) => readonly string[],
): Paginated<Row> => {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]
  const nextCursor =
    hasMore && last !== undefined
      ? encodeCursor(deps.config.cursorKey, { route, filterHash, sortValues: sortValues(last), now })
      : null
  return { items, page: { nextCursor, limit, hasMore } }
}

const adminScope = (userId: string, routeTemplate: string, key: string): IdempotencyScope => ({
  actorScope: `admin:${userId}`,
  actorScopeKeyVersion: null,
  candidateActorScopes: [`admin:${userId}`],
  method: "POST",
  routeTemplate,
  key,
})

// --- mappers ---

const mapApplicationListItem = (application: Application): Record<string, unknown> => {
  const isPiiTombstoned = application.pii_tombstoned_at !== null
  const compactId = application.id.replace(/-/gu, "")
  return {
    applicationId: application.id,
    fullName: isPiiTombstoned ? "Tombstoned" : application.full_name,
    email: isPiiTombstoned ? `tombstone+${compactId}@invalid.example` : application.email_normalized,
    phone: isPiiTombstoned ? `tombstone:${application.id}` : application.phone_e164,
    isPiiTombstoned,
    status: application.state,
    emailVerifiedAt: application.email_verified_at === null ? null : iso(application.email_verified_at),
    createdAt: iso(application.created_at),
    version: versionNumber(application.version),
  }
}

const mapDeliverySummary = (delivery: EmailDelivery): Record<string, unknown> => ({
  emailDeliveryId: delivery.id,
  templateKey: delivery.template_key,
  recipientMasked: delivery.recipient_masked,
  state: delivery.state,
  attemptCount: delivery.attempt_count,
  lastErrorCode: delivery.last_error_code,
  createdAt: iso(delivery.created_at),
  updatedAt: iso(delivery.updated_at),
})

// The full administrative projection adds subject/reference ids, SES ids, and the
// configuration set, but never ciphertext, nonce, HMAC, key version, or raw
// failure detail. Masked callers receive only the strict-safe summary.
const mapDeliveryAdmin = (delivery: EmailDelivery, full: boolean): Record<string, unknown> => {
  const summary = mapDeliverySummary(delivery)
  if (!full) return summary
  return {
    ...summary,
    outboxEventId: delivery.outbox_event_id,
    applicationId: delivery.application_id,
    userId: delivery.user_id,
    verificationTokenId: delivery.verification_token_id,
    activationInviteId: delivery.activation_invite_id,
    templateVersion: delivery.template_version,
    sesConfigurationSet: delivery.ses_configuration_set,
    sesMessageId: delivery.ses_message_id,
    sesRequestId: delivery.ses_request_id,
  }
}

// --- handlers ---

const listApplications = async (deps: AdminIdentityDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["applications.read"])
  const query = parseOrThrow(applicationsQuerySchema, request.query)

  if (query.createdFrom !== undefined && query.createdTo !== undefined) {
    const from = new Date(query.createdFrom).getTime()
    const to = new Date(query.createdTo).getTime()
    if (from >= to || to - from > MAX_QUEUE_INTERVAL_MS) {
      throw new AppError("VALIDATION_FAILED", { fields: { createdFrom: ["invalid createdFrom/createdTo range"] } })
    }
  }

  const now = deps.clock()
  const filterHash = computeFilterHash({
    status: query.status ?? null,
    createdFrom: query.createdFrom ?? null,
    createdTo: query.createdTo ?? null,
  })
  const keyset = readKeyset(deps, query.after, APPLICATIONS_ROUTE, filterHash, now)

  const rows = await deps.applicationRepository.queue(deps.database, {
    states: query.status === undefined ? WIRE_STATES : [query.status],
    ...(query.createdFrom === undefined ? {} : { createdFrom: new Date(query.createdFrom) }),
    ...(query.createdTo === undefined ? {} : { createdTo: new Date(query.createdTo) }),
    ...keyset,
    limit: query.limit + 1,
  })
  const { items, page } = paginate(deps, rows, query.limit, APPLICATIONS_ROUTE, filterHash, now, (row) => [
    iso(row.created_at),
    row.id,
  ])
  return reply.sendData({ items: items.map(mapApplicationListItem) }, { status: 200, page })
}

const getApplicationDetail = async (deps: AdminIdentityDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["applications.read"])
  requireAnyPermission(principal, ["email_deliveries.read", "email_deliveries.read_masked"])
  const applicationId = parseOrThrow(uuidParam, (request.params as { applicationId?: unknown }).applicationId)
  const query = parseOrThrow(applicationDetailQuerySchema, request.query)

  const application = await deps.applicationRepository.findById(deps.database, applicationId)
  if (application === null) throw new AppError("RESOURCE_NOT_FOUND")

  const now = deps.clock()
  const filterHash = computeFilterHash({ applicationId })
  const keyset = readKeyset(deps, query.deliveryAfter, `${APPLICATIONS_ROUTE}/:id/deliveries`, filterHash, now)

  const [consents, reviews, deliveryRows] = await Promise.all([
    deps.applicationRepository.listConsentDetails(deps.database, applicationId),
    deps.applicationRepository.listReviews(deps.database, applicationId),
    deps.emailDeliveryRepository.listByApplication(deps.database, {
      applicationId,
      ...keyset,
      limit: query.deliveryLimit + 1,
    }),
  ])
  const { items, page } = paginate(
    deps,
    deliveryRows,
    query.deliveryLimit,
    `${APPLICATIONS_ROUTE}/:id/deliveries`,
    filterHash,
    now,
    (row) => [iso(row.created_at), row.id],
  )

  return reply.sendData(
    {
      application: mapApplicationListItem(application),
      consents: consents.map((consent) => ({
        kind: consent.kind,
        version: consent.version,
        acceptedAt: iso(consent.acceptedAt),
      })),
      reviews: reviews.map((review) => ({
        reviewId: review.id,
        decision: review.decision,
        reasonCode: review.reason_code,
        reasonDetail: review.reason_detail,
        reviewerUserId: review.reviewer_user_id,
        decidedAt: iso(review.created_at),
      })),
      deliveries: { items: items.map(mapDeliverySummary), page },
    },
    { status: 200 },
  )
}

const postReview = async (deps: AdminIdentityDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["applications.review"])
  const applicationId = parseOrThrow(uuidParam, (request.params as { applicationId?: unknown }).applicationId)
  const idempotencyKey = requireIdempotencyKey(request)
  const body = parseOrThrow(reviewBodySchema, request.body)
  const now = deps.clock()

  const outcome = await deps.unitOfWork.execute((tx) =>
    executeIdempotent<Record<string, unknown>>({
      repository: deps.idempotencyRepository,
      tx,
      scope: adminScope(principal.userId, `${APPLICATIONS_ROUTE}/:id/review`, idempotencyKey),
      requestHash: hashRequest({ applicationId, expectedVersion: body.expectedVersion }),
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + deps.config.idempotencyTtlMs).toISOString(),
      execute: async () => {
        const { application } = await startApplicationReview(
          tx,
          { applicationRepository: deps.applicationRepository, auditRepository: deps.auditRepository, clock: deps.clock },
          { applicationId, reviewerUserId: principal.userId, expectedVersion: body.expectedVersion, requestId: request.requestId },
        )
        return {
          status: 200,
          body: {
            applicationId: application.id,
            status: "in_review",
            version: versionNumber(application.version),
            reviewStartedAt: iso(application.review_started_at ?? now),
          },
        }
      },
    }),
  )
  return reply.sendData(outcome.body, { status: outcome.status, ...(outcome.replay ? { idempotencyReplay: true } : {}) })
}

const postDecision = async (deps: AdminIdentityDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["applications.decide"])
  const applicationId = parseOrThrow(uuidParam, (request.params as { applicationId?: unknown }).applicationId)
  const { outcome: decision } = parseOrThrow(decisionQuerySchema, request.query)
  const idempotencyKey = requireIdempotencyKey(request)
  const expectedVersion = parseIfMatchVersion(request)
  const body = parseOrThrow(decisionBodySchema, request.body)
  const now = deps.clock()

  const result = await deps.unitOfWork.execute((tx) =>
    executeIdempotent<Record<string, unknown>>({
      repository: deps.idempotencyRepository,
      tx,
      scope: adminScope(principal.userId, `${APPLICATIONS_ROUTE}/:id/decision`, idempotencyKey),
      requestHash: hashRequest({ applicationId, decision, expectedVersion, reasonCode: body.reasonCode, reasonDetail: body.reasonDetail ?? null }),
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + deps.config.idempotencyTtlMs).toISOString(),
      execute: async () => {
        const decided = await decideApplication(
          tx,
          {
            applicationRepository: deps.applicationRepository,
            applicationReviewRepository: deps.applicationReviewRepository,
            userRepository: deps.userRepository,
            activationInviteRepository: deps.activationInviteRepository,
            outboxRepository: deps.outboxRepository,
            emailDeliveryRepository: deps.emailDeliveryRepository,
            auditRepository: deps.auditRepository,
            crypto: deps.crypto,
            clock: deps.clock,
            config: {
              activationInviteTtlMs: deps.config.activationInviteTtlMs,
              sesConfigurationSet: deps.config.sesConfigurationSet,
            },
          },
          {
            applicationId,
            reviewerUserId: principal.userId,
            decision,
            reasonCode: body.reasonCode,
            reasonDetail: body.reasonDetail ?? null,
            expectedVersion,
            requestId: request.requestId,
            idempotencyKey,
          },
        )
        return {
          status: 200,
          body: {
            applicationId: decided.application.id,
            status: decided.application.state,
            version: versionNumber(decided.application.version),
            ...(decided.user === null ? {} : { userId: decided.user.id }),
            ...(decided.activationInvite === null ? {} : { activationInviteId: decided.activationInvite.id }),
            emailDeliveryId: decided.emailDelivery.id,
            decidedAt: iso(decided.application.decided_at ?? now),
          },
        }
      },
    }),
  )
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

const postResendInvite = async (deps: AdminIdentityDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["invitations.manage"])
  const userId = parseOrThrow(uuidParam, (request.params as { userId?: unknown }).userId)
  const idempotencyKey = requireIdempotencyKey(request)
  const body = parseOrThrow(resendBodySchema, request.body)
  const now = deps.clock()

  const result = await deps.unitOfWork.execute((tx) =>
    executeIdempotent<Record<string, unknown>>({
      repository: deps.idempotencyRepository,
      tx,
      scope: adminScope(principal.userId, `/v1/admin/users/:userId/activation-invites/resend`, idempotencyKey),
      requestHash: hashRequest({ userId, expectedInviteId: body.expectedInviteId, reasonCode: body.reasonCode }),
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + deps.config.idempotencyTtlMs).toISOString(),
      execute: async () => {
        const resent = await resendActivationInvite(
          tx,
          {
            userRepository: deps.userRepository,
            activationInviteRepository: deps.activationInviteRepository,
            outboxRepository: deps.outboxRepository,
            emailDeliveryRepository: deps.emailDeliveryRepository,
            auditRepository: deps.auditRepository,
            crypto: deps.crypto,
            clock: deps.clock,
            config: {
              activationInviteTtlMs: deps.config.activationInviteTtlMs,
              sesConfigurationSet: deps.config.sesConfigurationSet,
            },
          },
          { userId, actorUserId: principal.userId, expectedInviteId: body.expectedInviteId, reasonCode: body.reasonCode, requestId: request.requestId },
        )
        return {
          status: 202,
          body: {
            userId,
            revokedInviteId: resent.revokedInviteId,
            activationInviteId: resent.activationInvite.id,
            emailDeliveryId: resent.emailDelivery.id,
            status: "queued",
            expiresAt: iso(resent.activationInvite.expires_at),
          },
        }
      },
    }),
  )
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

const listEmailDeliveries = async (deps: AdminIdentityDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["email_deliveries.read", "email_deliveries.read_masked"])
  const full = hasPermission(principal, "email_deliveries.read")
  const query = parseOrThrow(emailDeliveriesQuerySchema, request.query)

  const now = deps.clock()
  const filterHash = computeFilterHash({
    state: query.state ?? null,
    templateKey: query.templateKey ?? null,
    applicationId: query.applicationId ?? null,
    userId: query.userId ?? null,
  })
  const keyset = readKeyset(deps, query.after, EMAIL_DELIVERIES_ROUTE, filterHash, now)

  const rows = await deps.emailDeliveryRepository.adminList(deps.database, {
    ...(query.state === undefined ? {} : { states: [query.state] }),
    ...(query.templateKey === undefined ? {} : { templateKeys: [query.templateKey] }),
    ...(query.applicationId === undefined ? {} : { applicationId: query.applicationId }),
    ...(query.userId === undefined ? {} : { userId: query.userId }),
    ...keyset,
    limit: query.limit + 1,
  })
  const { items, page } = paginate(deps, rows, query.limit, EMAIL_DELIVERIES_ROUTE, filterHash, now, (row) => [
    iso(row.created_at),
    row.id,
  ])
  return reply.sendData({ items: items.map((row) => mapDeliveryAdmin(row, full)) }, { status: 200, page })
}

export const registerAdminIdentityRoutes = (application: FastifyInstance, deps: AdminIdentityDeps): void => {
  application.get(APPLICATIONS_ROUTE, async (request, reply) => listApplications(deps, request, reply))
  application.get(`${APPLICATIONS_ROUTE}/:applicationId`, async (request, reply) =>
    getApplicationDetail(deps, request, reply),
  )
  application.post(`${APPLICATIONS_ROUTE}/:applicationId/review`, async (request, reply) =>
    postReview(deps, request, reply),
  )
  application.post(`${APPLICATIONS_ROUTE}/:applicationId/decision`, async (request, reply) =>
    postDecision(deps, request, reply),
  )
  application.post("/v1/admin/users/:userId/activation-invites/resend", async (request, reply) =>
    postResendInvite(deps, request, reply),
  )
  application.get(EMAIL_DELIVERIES_ROUTE, async (request, reply) => listEmailDeliveries(deps, request, reply))
}
