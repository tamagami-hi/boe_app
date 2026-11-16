import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import { resolveClientPrincipal, type ClientRequestAuthDeps } from "../domain/auth/clientWebAuth.js"
import {
  REVIEW_SUBMISSION_MAX_REQUESTS,
  REVIEW_SUBMISSION_WINDOW_MS,
  submitClientReview,
  type ClientReviewDeps,
} from "../domain/client/clientReviews.js"
import { MAX_REVIEW_COMMENT_LENGTH, reviewRatingSchema, reviewTextSchema } from "../domain/shared/reviewText.js"
import { computeFilterHash } from "../http/cursor.js"
import { createdAtKeyset, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, paginate, readKeyset } from "../http/pagination.js"
import { createFixedWindowRateLimiter, type FixedWindowRateLimiter } from "../http/rateLimit.js"
import { parseOrThrow } from "../http/validation.js"
import { createActiveClientLockRepository } from "../repositories/activeClientLockRepository.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import { createClientReviewRepository, type ClientReviewRow } from "../repositories/clientReviewRepository.js"

export interface ClientReviewRouteDeps extends ClientRequestAuthDeps {
  readonly unitOfWork: UnitOfWork
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
  readonly config: { readonly cursorKey: Buffer }
}

interface ReviewRouteDeps extends ClientReviewRouteDeps, ClientReviewDeps {
  readonly submissionLimiter: FixedWindowRateLimiter
}

const REVIEWS_ROUTE = "/v1/client/reviews"

const listQuerySchema = z
  .object({
    after: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  })
  .strict()

const submitBodySchema = z
  .object({
    rating: reviewRatingSchema,
    comment: reviewTextSchema(MAX_REVIEW_COMMENT_LENGTH).nullable(),
  })
  .strict()

const reviewBody = (row: ClientReviewRow) => ({
  id: row.id,
  rating: row.rating,
  comment: row.comment,
  submittedAt: new Date(row.createdAt).toISOString(),
})

const listReviews = async (deps: ReviewRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const query = parseOrThrow(listQuerySchema, request.query ?? {})
  const now = deps.clock()
  const filterHash = computeFilterHash({ userId: principal.userId })
  const keyset = readKeyset(deps.config.cursorKey, query.after, REVIEWS_ROUTE, filterHash, now)
  const { rows, status } = await deps.unitOfWork.execute(async (tx) => ({
    rows: await deps.clientReviewRepository.listByUser(tx, { userId: principal.userId, ...keyset, limit: query.limit + 1 }),
    status: await deps.clientReviewRepository.submissionStatus(tx, { userId: principal.userId, now }),
  }))
  const { items, page } = paginate(deps.config.cursorKey, rows, query.limit, REVIEWS_ROUTE, filterHash, now, createdAtKeyset)
  return reply.sendData(
    {
      items: items.map(reviewBody),
      canSubmit: !status.hasReviewThisMonth,
      nextSubmissionOn: status.hasReviewThisMonth ? status.nextMonthStart : null,
    },
    { status: 200, page },
  )
}

const submitReview = async (deps: ReviewRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  deps.submissionLimiter.hit(principal.userId)
  const body = parseOrThrow(submitBodySchema, request.body ?? {})
  const created = await deps.unitOfWork.execute((tx) =>
    submitClientReview(tx, deps, {
      userId: principal.userId,
      rating: body.rating,
      comment: body.comment,
      requestId: request.requestId,
    }),
  )
  return reply.sendData(reviewBody(created), { status: 201 })
}

export const registerClientReviewRoutes = (application: FastifyInstance, base: ClientReviewRouteDeps): void => {
  const deps: ReviewRouteDeps = {
    ...base,
    clientReviewRepository: createClientReviewRepository(),
    activeClientLockRepository: createActiveClientLockRepository(),
    submissionLimiter: createFixedWindowRateLimiter(
      { windowMs: REVIEW_SUBMISSION_WINDOW_MS, maxRequests: REVIEW_SUBMISSION_MAX_REQUESTS },
      base.clock,
    ),
  }
  application.get(REVIEWS_ROUTE, (request, reply) => listReviews(deps, request, reply))
  application.post(REVIEWS_ROUTE, (request, reply) => submitReview(deps, request, reply))
}
