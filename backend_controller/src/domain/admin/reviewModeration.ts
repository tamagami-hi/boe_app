import type { Transaction } from "../../db/repositories.js"
import type { ClientReviewState } from "../../db/types.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AdminReviewDetailRow, AdminReviewRepository } from "../../repositories/adminReviewRepository.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"

const STALE_MESSAGE = "Someone changed this review since you opened it. Reload it and try again."

export interface ReviewModerationDeps {
  readonly adminReviewRepository: AdminReviewRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
}

export interface ReviewModerationCommand {
  readonly reviewId: string
  readonly expectedVersion: number
  readonly state: ClientReviewState
  readonly moderationNote: string | null
  readonly actorUserId: string
  readonly requestId: string
}

export const moderateClientReview = async (
  tx: Transaction,
  deps: ReviewModerationDeps,
  command: ReviewModerationCommand,
): Promise<AdminReviewDetailRow> => {
  const current = await deps.adminReviewRepository.lockReview(tx, command.reviewId)
  if (current === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (Number(current.version) !== command.expectedVersion) {
    throw new AppError("STATE_CONFLICT", { message: STALE_MESSAGE })
  }
  const noteChanged = command.moderationNote !== current.moderationNote
  if (!noteChanged && command.state === current.state) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { moderationNote: ["repeats the current state and note; change one of them"] },
    })
  }
  const applied = await deps.adminReviewRepository.applyModeration(tx, {
    reviewId: command.reviewId,
    expectedVersion: command.expectedVersion,
    state: command.state,
    moderationNote: command.moderationNote,
    actorUserId: command.actorUserId,
    now: deps.clock(),
  })
  const updated = applied ? await deps.adminReviewRepository.findReview(tx, command.reviewId) : null
  if (updated === null) throw new AppError("STATE_CONFLICT", { message: STALE_MESSAGE })
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: command.actorUserId,
    command: "client_review.moderated",
    entityType: "client_review",
    entityId: updated.id,
    fromState: current.state,
    toState: updated.state,
    requestId: command.requestId,
    entityVersion: Number(updated.version),
    metadata: { noteChanged },
  })
  return updated
}
