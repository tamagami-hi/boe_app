import { z } from "zod"

import { createPaginatedSuccessEnvelopeSchema, createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, Uuid } from "../scalars.js"
import {
  ADMIN_PAGED_READ_ERRORS,
  ADMIN_READ_ERRORS,
  ADMIN_WRITE_ERRORS,
  AdminCursor,
  AdminLimit,
  AdminPageMeta,
  RequiredAdminMutationHeaders,
} from "./admin-shared.js"
import { IsoDate, ListQuery } from "./client.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

export const MIN_REVIEW_RATING = 1
export const MAX_REVIEW_RATING = 5
export const MAX_REVIEW_COMMENT_LENGTH = 1_000
export const MAX_REVIEW_NOTE_LENGTH = 1_000

const REVIEW_TEXT_PATTERN = /^(?![\u200c\u200d])(?:[^\p{Cc}\p{Cf}\p{Cs}\u2028\u2029\u034f\u115f\u1160\u2800\u3164\uffa0]|[\n\u200c\u200d])*(?<![\u200c\u200d])$/u
const VISIBLE_CHARACTER_PATTERN = /[\p{L}\p{N}\p{P}\p{S}]/u

const ReviewText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).regex(REVIEW_TEXT_PATTERN).regex(VISIBLE_CHARACTER_PATTERN)

export const ReviewRating = z.number().int().min(MIN_REVIEW_RATING).max(MAX_REVIEW_RATING)

export const ClientReviewState = z.enum(["new", "read", "hidden"])
export type ClientReviewState = z.infer<typeof ClientReviewState>

export const ClientReview = z.strictObject({
  id: Uuid,
  rating: ReviewRating,
  comment: z.string().nullable(),
  submittedAt: IsoDateTime,
})
export type ClientReview = z.infer<typeof ClientReview>

export const ClientReviewsData = z.strictObject({
  items: z.array(ClientReview),
  canSubmit: z.boolean(),
  nextSubmissionOn: IsoDate.nullable(),
})
export type ClientReviewsData = z.infer<typeof ClientReviewsData>

const CLIENT_READ_ERRORS = [
  "AUTHENTICATION_REQUIRED",
  "SESSION_INVALID",
  "ACCOUNT_NOT_ACTIVE",
  "CSRF_INVALID",
  "CURSOR_INVALID",
  "VALIDATION_FAILED",
  "INTERNAL_ERROR",
] as const

export const listClientReviews = defineOperation({
  operationId: "listClientReviews",
  method: "GET",
  path: "/v1/client/reviews",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: { query: ListQuery },
  success: { status: 200, schema: createPaginatedSuccessEnvelopeSchema(ClientReviewsData) },
  errorCodes: [...CLIENT_READ_ERRORS],
})

export const SubmitClientReviewBody = z.strictObject({
  rating: ReviewRating,
  comment: ReviewText(MAX_REVIEW_COMMENT_LENGTH).nullable(),
})
export type SubmitClientReviewBody = z.infer<typeof SubmitClientReviewBody>

export const submitClientReview = defineOperation({
  operationId: "submitClientReview",
  method: "POST",
  path: "/v1/client/reviews",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "none",
  responseCacheControl: "no-store",
  request: {
    body: SubmitClientReviewBody,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: createSuccessEnvelopeSchema(ClientReview) },
  errorCodes: [
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "ACCOUNT_NOT_ACTIVE",
    "CSRF_INVALID",
    "VALIDATION_FAILED",
    "PAYLOAD_TOO_LARGE",
    "UNSUPPORTED_MEDIA_TYPE",
    "STATE_CONFLICT",
    "RATE_LIMITED",
    "INTERNAL_ERROR",
  ],
})

export const AdminClientReview = z.strictObject({
  id: Uuid,
  userId: Uuid,
  clientName: z.string(),
  rating: ReviewRating,
  comment: z.string().nullable(),
  state: ClientReviewState,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  version: z.number().int().positive(),
})
export type AdminClientReview = z.infer<typeof AdminClientReview>

export const AdminClientReviewDetail = AdminClientReview.extend({
  moderationNote: z.string().nullable(),
  moderatedAt: IsoDateTime.nullable(),
  moderatorName: z.string().nullable(),
})
export type AdminClientReviewDetail = z.infer<typeof AdminClientReviewDetail>

const AdminClientReviewPage = createSuccessEnvelopeSchema(
  z.strictObject({ items: z.array(AdminClientReview) }),
  { page: AdminPageMeta },
)

export const AdminClientReviewsQuery = z.strictObject({
  after: AdminCursor,
  limit: AdminLimit,
  state: ClientReviewState.optional(),
  rating: z.coerce.number().int().min(MIN_REVIEW_RATING).max(MAX_REVIEW_RATING).optional(),
})

export const listAdminClientReviews = defineOperation({
  operationId: "listAdminClientReviews",
  method: "GET",
  path: "/v1/admin/reviews",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { query: AdminClientReviewsQuery },
  success: { status: 200, schema: AdminClientReviewPage },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS],
})

const ReviewId = z.strictObject({ reviewId: Uuid })

export const getAdminClientReview = defineOperation({
  operationId: "getAdminClientReview",
  method: "GET",
  path: "/v1/admin/reviews/{reviewId}",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: ReviewId },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminClientReviewDetail) },
  errorCodes: [...ADMIN_READ_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const ModerateClientReviewBody = z.strictObject({
  state: ClientReviewState,
  moderationNote: ReviewText(MAX_REVIEW_NOTE_LENGTH).nullable(),
  expectedVersion: z.number().int().positive(),
})
export type ModerateClientReviewBody = z.infer<typeof ModerateClientReviewBody>

export const moderateAdminClientReview = defineOperation({
  operationId: "moderateAdminClientReview",
  method: "POST",
  path: "/v1/admin/reviews/{reviewId}/moderation",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: ReviewId,
    body: ModerateClientReviewBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminClientReviewDetail) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const AdminUserClientReviewsQuery = z.strictObject({
  after: AdminCursor,
  limit: AdminLimit,
})

export const listAdminUserClientReviews = defineOperation({
  operationId: "listAdminUserClientReviews",
  method: "GET",
  path: "/v1/admin/users/{userId}/reviews",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: z.strictObject({ userId: Uuid }), query: AdminUserClientReviewsQuery },
  success: { status: 200, schema: AdminClientReviewPage },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const CLIENT_REVIEW_OPERATIONS = Object.freeze([
  listClientReviews,
  submitClientReview,
  listAdminClientReviews,
  getAdminClientReview,
  moderateAdminClientReview,
  listAdminUserClientReviews,
])
