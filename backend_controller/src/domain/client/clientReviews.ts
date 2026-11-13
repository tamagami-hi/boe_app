import type { Transaction } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { ClientReviewRepository, ClientReviewRow } from "../../repositories/clientReviewRepository.js"

export const REVIEW_SUBMISSION_WINDOW_MS = 10 * 60_000
export const REVIEW_SUBMISSION_MAX_REQUESTS = 5

const ALREADY_REVIEWED_MESSAGE =
  "You have already shared a review this month. You can share another from the first day of next month."

export interface ClientReviewDeps {
  readonly clientReviewRepository: ClientReviewRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
}

export interface SubmitClientReviewCommand {
  readonly userId: string
  readonly rating: number
  readonly comment: string | null
  readonly requestId: string
}

export const submitClientReview = async (
  tx: Transaction,
  deps: ClientReviewDeps,
  command: SubmitClientReviewCommand,
): Promise<ClientReviewRow> => {
  const created = await deps.clientReviewRepository.insertOncePerMonth(tx, {
    userId: command.userId,
    rating: command.rating,
    comment: command.comment,
    now: deps.clock(),
  })
  if (created === null) throw new AppError("STATE_CONFLICT", { message: ALREADY_REVIEWED_MESSAGE })
  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: command.userId,
    command: "client_review.submitted",
    entityType: "client_review",
    entityId: created.id,
    toState: "new",
    requestId: command.requestId,
    entityVersion: 1,
    metadata: { rating: created.rating, hasComment: created.comment !== null },
  })
  return created
}
