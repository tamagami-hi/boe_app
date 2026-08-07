/**
 * Start application review (spec 04 §3.2). The transition locks the row, records
 * the reviewer and start time, bumps the optimistic version, and appends audit
 * evidence. A stale expected version or an already-decided application is a
 * STATE_CONFLICT. Starting review creates no decision row.
 *
 * Two states may enter `in_review`, not one. `submitted` is the ordinary route: a
 * signup whose email link has been redeemed. `pending_email_verification` is
 * admitted as well because approval is the real eligibility gate here and the
 * confirmation mail is not guaranteed to arrive — when it does not, requiring
 * `submitted` first left the application permanently unreviewable and produced a
 * 409 the reviewer could do nothing about. Review is only the handshake; whether
 * an unconfirmed address may be *approved* is decided in `decideApplication`,
 * which requires the reviewer to say so explicitly.
 */
import type { Application, Transaction } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { ApplicationWriteRepository } from "../../repositories/applicationRepository.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"

export interface StartReviewDeps {
  readonly applicationRepository: ApplicationWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
}

export interface StartReviewInput {
  readonly applicationId: string
  readonly reviewerUserId: string
  readonly expectedVersion: number
  readonly requestId: string
}

export const startApplicationReview = async (
  tx: Transaction,
  deps: StartReviewDeps,
  input: StartReviewInput,
): Promise<{ readonly application: Application }> => {
  const application = await deps.applicationRepository.lockById(tx, input.applicationId)
  if (application === null) throw new AppError("RESOURCE_NOT_FOUND")

  // Already in review is not a failure: the console re-runs the handshake when
  // its snapshot is stale, and re-entering a state you are already in is the
  // outcome the caller asked for. Returning the row keeps the caller's version in
  // step without a wasted write.
  if (application.state === "in_review") return { application }

  if (application.state === "approved" || application.state === "rejected") {
    throw new AppError("STATE_CONFLICT", {
      message: `This application was already ${application.state}. Reload the queue to see its current state.`,
    })
  }
  if (application.state === "withdrawn") {
    throw new AppError("STATE_CONFLICT", { message: "This application was withdrawn and can no longer be reviewed." })
  }
  if (Number(application.version) !== input.expectedVersion) {
    throw new AppError("STATE_CONFLICT", {
      message: "This application changed while you were reviewing it. Reload the queue and try again.",
    })
  }

  const fromState = application.state
  const updated = await deps.applicationRepository.startReview(tx, {
    applicationId: input.applicationId,
    now: deps.clock(),
  })
  if (updated === null) {
    throw new AppError("STATE_CONFLICT", {
      message: "This application changed while you were reviewing it. Reload the queue and try again.",
    })
  }

  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: input.reviewerUserId,
    command: "application.review_start",
    entityType: "application",
    entityId: input.applicationId,
    fromState,
    toState: "in_review",
    requestId: input.requestId,
    entityVersion: Number(updated.version),
    metadata: { emailVerifiedAtReview: application.email_verified_at !== null },
  })

  return { application: updated }
}
