/**
 * Start application review (spec 04 §3.2). Only a `submitted` application may
 * enter `in_review`; the transition locks the row, records the reviewer and
 * start time, bumps the optimistic version, and appends audit evidence. A stale
 * expected version or a non-submitted state is a STATE_CONFLICT. Starting review
 * creates no decision row.
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
  if (Number(application.version) !== input.expectedVersion) throw new AppError("STATE_CONFLICT")
  if (application.state !== "submitted") throw new AppError("STATE_CONFLICT")

  const updated = await deps.applicationRepository.startReview(tx, {
    applicationId: input.applicationId,
    now: deps.clock(),
  })
  if (updated === null) throw new AppError("STATE_CONFLICT")

  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: input.reviewerUserId,
    command: "application.review_start",
    entityType: "application",
    entityId: input.applicationId,
    fromState: "submitted",
    toState: "in_review",
    requestId: input.requestId,
    entityVersion: Number(updated.version),
    metadata: {},
  })

  return { application: updated }
}
