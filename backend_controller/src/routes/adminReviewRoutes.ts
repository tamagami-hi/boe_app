import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository } from "../db/repositories.js"
import type { ClientReviewState } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import { moderateClientReview } from "../domain/admin/reviewModeration.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { MAX_REVIEW_NOTE_LENGTH, reviewTextSchema } from "../domain/shared/reviewText.js"
import { AppError } from "../http/errorCatalog.js"
import { createdAtKeyset, paginate, readKeyset } from "../http/pagination.js"
import { parseOrThrow } from "../http/validation.js"
import {
  createAdminReviewRepository,
  type AdminReviewDetailRow,
  type AdminReviewRepository,
  type AdminReviewRow,
} from "../repositories/adminReviewRepository.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { WithCursor } from "../repositories/keysetBoundary.js"
import {
  adminIdempotencyScope,
  computeFilterHash,
  hashRequest,
  iso,
  isoOrNull,
  limitSchema,
  requireIdempotencyKey,
  runAdminMutation,
  uuidParam,
} from "./adminRouteKit.js"

const REVIEWS_ROUTE = "/v1/admin/reviews"
const REVIEW_ROUTE = `${REVIEWS_ROUTE}/:reviewId`
const MODERATION_ROUTE = `${REVIEW_ROUTE}/moderation`
const USER_REVIEWS_ROUTE = "/v1/admin/users/:userId/reviews"
const READ_PERMISSIONS = ["support.read"]
const WRITE_PERMISSIONS = ["support.write"]

const REVIEW_STATES = ["new", "read", "hidden"] as const satisfies readonly ClientReviewState[]

export interface AdminReviewDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly config: { readonly cursorKey: Buffer; readonly idempotencyTtlMs: number }
  readonly auditRepository: AuditWriteRepository
  readonly idempotencyRepository: IdempotencyRepository
}

interface ReviewRouteDeps extends AdminReviewDeps {
  readonly adminReviewRepository: AdminReviewRepository
}

const pageQuery = { after: z.string().min(1).optional(), limit: limitSchema }

const inboxQuerySchema = z
  .object({
    ...pageQuery,
    state: z.enum(REVIEW_STATES).optional(),
    rating: z.coerce.number().int().min(1).max(5).optional(),
  })
  .strict()

const userReviewsQuerySchema = z.object(pageQuery).strict()

const moderationBodySchema = z
  .object({
    state: z.enum(REVIEW_STATES),
    moderationNote: reviewTextSchema(MAX_REVIEW_NOTE_LENGTH).nullable(),
    expectedVersion: z.number().int().positive(),
  })
  .strict()

const reviewBody = (row: AdminReviewRow) => ({
  id: row.id,
  userId: row.userId,
  clientName: row.clientName,
  rating: row.rating,
  comment: row.comment,
  state: row.state,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
  version: Number(row.version),
})

const detailBody = (row: AdminReviewDetailRow) => ({
  ...reviewBody(row),
  moderationNote: row.moderationNote,
  moderatedAt: isoOrNull(row.moderatedAt),
  moderatorName: row.moderatorName,
})

const paramOf = (request: FastifyRequest, name: "reviewId" | "userId"): string =>
  parseOrThrow(uuidParam, (request.params as Record<string, unknown> | undefined)?.[name])

const sendPage = (
  deps: ReviewRouteDeps,
  reply: FastifyReply,
  route: string,
  filterHash: string,
  now: Date,
  limit: number,
  rows: readonly WithCursor<AdminReviewRow>[],
) => {
  const { items, page } = paginate(deps.config.cursorKey, rows, limit, route, filterHash, now, createdAtKeyset)
  return reply.sendData({ items: items.map(reviewBody) }, { status: 200, page })
}

const listInbox = async (deps: ReviewRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, READ_PERMISSIONS)
  const query = parseOrThrow(inboxQuerySchema, request.query ?? {})
  const now = deps.clock()
  const filterHash = computeFilterHash({ state: query.state ?? null, rating: query.rating ?? null })
  const keyset = readKeyset(deps.config.cursorKey, query.after, REVIEWS_ROUTE, filterHash, now)
  const rows = await deps.unitOfWork.execute((tx) =>
    deps.adminReviewRepository.listInbox(tx, {
      ...keyset,
      ...(query.state === undefined ? {} : { state: query.state }),
      ...(query.rating === undefined ? {} : { rating: query.rating }),
      limit: query.limit + 1,
    }),
  )
  return sendPage(deps, reply, REVIEWS_ROUTE, filterHash, now, query.limit, rows)
}

const listUserReviews = async (deps: ReviewRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, READ_PERMISSIONS)
  const userId = paramOf(request, "userId")
  const query = parseOrThrow(userReviewsQuerySchema, request.query ?? {})
  const now = deps.clock()
  const filterHash = computeFilterHash({ userId })
  const keyset = readKeyset(deps.config.cursorKey, query.after, USER_REVIEWS_ROUTE, filterHash, now)
  const rows = await deps.unitOfWork.execute(async (tx) => {
    if (!(await deps.adminReviewRepository.userExists(tx, userId))) return null
    return deps.adminReviewRepository.listForUser(tx, { userId, ...keyset, limit: query.limit + 1 })
  })
  if (rows === null) throw new AppError("RESOURCE_NOT_FOUND")
  return sendPage(deps, reply, USER_REVIEWS_ROUTE, filterHash, now, query.limit, rows)
}

const getReview = async (deps: ReviewRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, READ_PERMISSIONS)
  const reviewId = paramOf(request, "reviewId")
  const found = await deps.unitOfWork.execute((tx) => deps.adminReviewRepository.findReview(tx, reviewId))
  if (found === null) throw new AppError("RESOURCE_NOT_FOUND")
  return reply.sendData(detailBody(found), { status: 200 })
}

const moderate = async (deps: ReviewRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, WRITE_PERMISSIONS)
  const reviewId = paramOf(request, "reviewId")
  const body = parseOrThrow(moderationBodySchema, request.body)
  const key = requireIdempotencyKey(request)
  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, MODERATION_ROUTE, key),
    requestHash: hashRequest({ reviewId, ...body }),
    execute: async (tx) => {
      const review = await moderateClientReview(tx, deps, {
        reviewId,
        expectedVersion: body.expectedVersion,
        state: body.state,
        moderationNote: body.moderationNote,
        actorUserId: principal.userId,
        requestId: request.requestId,
      })
      return { status: 200, body: detailBody(review) }
    },
  })
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

export const registerAdminReviewRoutes = (application: FastifyInstance, base: AdminReviewDeps): void => {
  const deps: ReviewRouteDeps = { ...base, adminReviewRepository: createAdminReviewRepository() }
  application.get(REVIEWS_ROUTE, (request, reply) => listInbox(deps, request, reply))
  application.get(REVIEW_ROUTE, (request, reply) => getReview(deps, request, reply))
  application.post(MODERATION_ROUTE, (request, reply) => moderate(deps, request, reply))
  application.get(USER_REVIEWS_ROUTE, (request, reply) => listUserReviews(deps, request, reply))
}
