/**
 * Application-review repository (spec 03 §7, 04 §3.2). One decision row per
 * application (`application_reviews_application_uk`) carrying the reviewer, the
 * decision, and the reason evidence; the reviewer+idempotency-key uniqueness
 * backstops the idempotency protocol.
 */
import type { ApplicationReview, Transaction } from "../db/repositories.js"

export interface InsertReviewInput {
  readonly applicationId: string
  readonly reviewerUserId: string
  readonly decision: "approved" | "rejected"
  readonly reasonCode: string
  readonly reasonDetail: string | null
  readonly requestId: string
  readonly idempotencyKey: string
}

export interface ApplicationReviewWriteRepository {
  insert: (tx: Transaction, input: InsertReviewInput) => Promise<ApplicationReview>
}

export const createApplicationReviewRepository = (): ApplicationReviewWriteRepository => ({
  insert: async (tx, input) =>
    tx
      .insertInto("application_reviews")
      .values({
        application_id: input.applicationId,
        reviewer_user_id: input.reviewerUserId,
        decision: input.decision,
        reason_code: input.reasonCode,
        reason_detail: input.reasonDetail,
        request_id: input.requestId,
        idempotency_key: input.idempotencyKey,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
})
