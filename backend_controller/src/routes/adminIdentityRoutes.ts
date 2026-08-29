/**
 * Admin identity/compliance routes (spec 04 §3.2). Web-cookie transport with
 * RBAC permission checks (§4.5); unsafe methods additionally require the
 * synchronizer CSRF token and an Idempotency-Key. List endpoints use the
 * authenticated opaque cursor. The decision mutation runs under the database
 * idempotency protocol so a replay returns the first committed result.
 *
 * The application decision is a single step: `POST .../decision?outcome=`
 * straight from `submitted`. There is no review handshake, no reason the admin
 * has to supply, and no activation invite to resend — approval always produces
 * an active account with the signup credential and the account-approved mail.
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
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { computeFilterHash } from "../http/cursor.js"
import { AppError } from "../http/errorCatalog.js"
import { executeIdempotent } from "../http/idempotencyProtocol.js"
import { createdAtKeyset, paginate, readKeyset } from "../http/pagination.js"
import { parseOrThrow } from "../http/validation.js"
import { latestPublishedApkUrl, type ReleaseFeed } from "../release/releaseFeed.js"
import type { ApplicationWriteRepository } from "../repositories/applicationRepository.js"
import type { ApplicationReviewWriteRepository } from "../repositories/applicationReviewRepository.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { CredentialWriteRepository } from "../repositories/credentialRepository.js"
import type { EmailDeliveryWriteRepository } from "../repositories/emailDeliveryRepository.js"
import type { OutboxWriteRepository } from "../repositories/outboxRepository.js"
import type { UserWriteRepository } from "../repositories/userRepository.js"
import { requireIdempotencyKey } from "./adminRouteKit.js"

export interface AdminIdentityConfig {
  readonly cursorKey: Buffer
  readonly idempotencyTtlMs: number
  readonly sesConfigurationSet: string
}

export interface AdminIdentityDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly crypto: CryptoContext
  readonly config: AdminIdentityConfig
  /**
   * The published-APK feed the approval mail's download link is resolved from —
   * the same sidecar/base-URL pair `GET /v1/app/update` serves.
   */
  readonly appUpdate: ReleaseFeed
  readonly applicationRepository: ApplicationWriteRepository
  readonly applicationReviewRepository: ApplicationReviewWriteRepository
  readonly userRepository: UserWriteRepository
  readonly credentialRepository: CredentialWriteRepository
  readonly outboxRepository: OutboxWriteRepository
  readonly emailDeliveryRepository: EmailDeliveryWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly idempotencyRepository: IdempotencyRepository
}

const APPLICATIONS_ROUTE = "/v1/admin/applications"
const EMAIL_DELIVERIES_ROUTE = "/v1/admin/email-deliveries"
const MAX_QUEUE_INTERVAL_MS = 366 * 24 * 60 * 60 * 1000
const WIRE_STATES: readonly ApplicationState[] = ["submitted", "approved", "rejected", "withdrawn"]

const iso = (value: Date | string): string => new Date(value).toISOString()
const versionNumber = (value: unknown): number => Number(value)

// --- validation schemas ---

const statusEnum = z.enum(["submitted", "approved", "rejected", "withdrawn"])
const deliveryStateEnum = z.enum([
  "queued",
  "sending",
  "sent",
  "delivered",
  "retryable_failed",
  "permanent_failed",
  "cancelled",
])
const templateKeyEnum = z.enum(["application_rejected", "account_approved"])
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

/**
 * The decision takes no input: the admin chooses Approve or Reject and nothing
 * else. An empty object is accepted so a client that posts `{}` and one that
 * posts no body behave identically; anything else is refused rather than
 * silently dropped.
 */
const decisionBodySchema = z.object({}).strict()
const decisionQuerySchema = z.object({ outcome: z.enum(["approved", "rejected"]) }).strict()
const uuidParam = z.string().uuid()

// --- helpers ---

const hashRequest = (canonical: Readonly<Record<string, unknown>>): Buffer =>
  createHash("sha256").update(JSON.stringify(canonical)).digest()

interface KeysetPosition {
  readonly afterCreatedAt?: Date
  readonly afterId?: string
}

const keysetFor = (
  deps: AdminIdentityDeps,
  after: string | undefined,
  route: string,
  filterHash: string,
  now: Date,
): KeysetPosition => readKeyset(deps.config.cursorKey, after, route, filterHash, now)

const CREATED_AT_KEYSET = createdAtKeyset<{ readonly id: string; readonly created_at: Date | string }>(
  (row) => row.created_at,
)

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
    /**
     * Whether the applicant chose a password at signup. Never the hash itself —
     * the console only needs to know approval will produce a sign-in-ready
     * account.
     */
    hasSignupPassword: application.password_hash !== null,
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
  const keyset = keysetFor(deps, query.after, APPLICATIONS_ROUTE, filterHash, now)

  const rows = await deps.applicationRepository.queue(deps.database, {
    states: query.status === undefined ? WIRE_STATES : [query.status],
    ...(query.createdFrom === undefined ? {} : { createdFrom: new Date(query.createdFrom) }),
    ...(query.createdTo === undefined ? {} : { createdTo: new Date(query.createdTo) }),
    ...keyset,
    limit: query.limit + 1,
  })
  const { items, page } = paginate(
    deps.config.cursorKey,
    rows,
    query.limit,
    APPLICATIONS_ROUTE,
    filterHash,
    now,
    CREATED_AT_KEYSET,
  )
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
  const keyset = keysetFor(deps, query.deliveryAfter, `${APPLICATIONS_ROUTE}/:id/deliveries`, filterHash, now)

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
    deps.config.cursorKey,
    deliveryRows,
    query.deliveryLimit,
    `${APPLICATIONS_ROUTE}/:id/deliveries`,
    filterHash,
    now,
    CREATED_AT_KEYSET,
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

const postDecision = async (deps: AdminIdentityDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["applications.decide"])
  const applicationId = parseOrThrow(uuidParam, (request.params as { applicationId?: unknown }).applicationId)
  const { outcome: decision } = parseOrThrow(decisionQuerySchema, request.query)
  const idempotencyKey = requireIdempotencyKey(request)
  parseOrThrow(decisionBodySchema, request.body ?? {})
  const now = deps.clock()

  /*
   * The approval mail carries the official client APK download link, resolved
   * from the same release feed the app's update check reads. Resolved here,
   * before the transaction: it is a filesystem read, not domain state, and the
   * mail must never block the decision — with nothing published the email
   * still goes out (without a link) and the gap is logged.
   */
  let apkDownloadUrl: string | null = null
  if (decision === "approved") {
    apkDownloadUrl = await latestPublishedApkUrl(deps.appUpdate, "client")
    if (apkDownloadUrl === null) {
      request.log.warn(
        { applicationId },
        "no published client APK found; the account-approved email will be sent without a download link",
      )
    }
  }

  const result = await deps.unitOfWork.execute((tx) =>
    executeIdempotent<Record<string, unknown>>({
      repository: deps.idempotencyRepository,
      tx,
      scope: adminScope(principal.userId, `${APPLICATIONS_ROUTE}/:id/decision`, idempotencyKey),
      requestHash: hashRequest({ applicationId, decision }),
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + deps.config.idempotencyTtlMs).toISOString(),
      execute: async () => {
        const decided = await decideApplication(
          tx,
          {
            applicationRepository: deps.applicationRepository,
            applicationReviewRepository: deps.applicationReviewRepository,
            userRepository: deps.userRepository,
            credentialRepository: deps.credentialRepository,
            outboxRepository: deps.outboxRepository,
            emailDeliveryRepository: deps.emailDeliveryRepository,
            auditRepository: deps.auditRepository,
            crypto: deps.crypto,
            clock: deps.clock,
            config: { sesConfigurationSet: deps.config.sesConfigurationSet },
          },
          {
            applicationId,
            reviewerUserId: principal.userId,
            decision,
            apkDownloadUrl,
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
            // Tells the console they can sign in now with the signup password.
            accountActivated: decided.accountActivated,
            emailDeliveryId: decided.emailDelivery.id,
            decidedAt: iso(decided.application.decided_at ?? now),
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
  const keyset = keysetFor(deps, query.after, EMAIL_DELIVERIES_ROUTE, filterHash, now)

  const rows = await deps.emailDeliveryRepository.adminList(deps.database, {
    ...(query.state === undefined ? {} : { states: [query.state] }),
    ...(query.templateKey === undefined ? {} : { templateKeys: [query.templateKey] }),
    ...(query.applicationId === undefined ? {} : { applicationId: query.applicationId }),
    ...(query.userId === undefined ? {} : { userId: query.userId }),
    ...keyset,
    limit: query.limit + 1,
  })
  const { items, page } = paginate(
    deps.config.cursorKey,
    rows,
    query.limit,
    EMAIL_DELIVERIES_ROUTE,
    filterHash,
    now,
    CREATED_AT_KEYSET,
  )
  return reply.sendData({ items: items.map((row) => mapDeliveryAdmin(row, full)) }, { status: 200, page })
}

/**
 * `GET /v1/admin/session` — who am I, and what may I do.
 *
 * The browser console recovers its principal from `GET /v1/auth/web/csrf`,
 * which reads the HttpOnly cookies. The Android console has no usable cookie
 * (see the note in domain/admin/adminAccess.ts), so it needs a bearer-readable
 * equivalent to restore a session after a cold start and to establish that the
 * signed-in user is actually an admin — a native login proves identity but says
 * nothing about authority.
 *
 * No permission is required beyond holding an admin role: the response only
 * describes the caller to itself. A user with no roles is rejected, so this
 * cannot be used by a plain client account to probe the admin surface.
 */
const getSession = async (deps: AdminIdentityDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  if (principal.roles.length === 0) throw new AppError("AUTHORIZATION_DENIED")

  const user = await deps.database
    .selectFrom("users")
    .select(["id", "full_name", "email_normalized"])
    .where("id", "=", principal.userId)
    .executeTakeFirst()
  if (user === undefined) throw new AppError("AUTHORIZATION_DENIED")

  return reply.sendData(
    {
      userId: principal.userId,
      fullName: user.full_name,
      email: user.email_normalized,
      roles: principal.roles,
      permissions: principal.permissions,
    },
    { status: 200 },
  )
}

export const registerAdminIdentityRoutes = (application: FastifyInstance, deps: AdminIdentityDeps): void => {
  application.get("/v1/admin/session", async (request, reply) => getSession(deps, request, reply))
  application.get(APPLICATIONS_ROUTE, async (request, reply) => listApplications(deps, request, reply))
  application.get(`${APPLICATIONS_ROUTE}/:applicationId`, async (request, reply) =>
    getApplicationDetail(deps, request, reply),
  )
  application.post(`${APPLICATIONS_ROUTE}/:applicationId/decision`, async (request, reply) =>
    postDecision(deps, request, reply),
  )
  application.get(EMAIL_DELIVERIES_ROUTE, async (request, reply) => listEmailDeliveries(deps, request, reply))
}
