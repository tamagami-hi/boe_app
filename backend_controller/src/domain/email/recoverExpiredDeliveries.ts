import type { UnitOfWork } from "../../db/database.js"
import { nextRetryDelayMs } from "../../email/retrySchedule.js"
import type { EmailDeliveryWriteRepository } from "../../repositories/emailDeliveryRepository.js"
import type { OutboxWriteRepository } from "../../repositories/outboxRepository.js"

export interface RecoverExpiredDeliveriesDeps {
  readonly unitOfWork: UnitOfWork
  readonly outboxRepository: OutboxWriteRepository
  readonly emailDeliveryRepository: EmailDeliveryWriteRepository
  readonly clock: () => Date
  readonly batchLimit: number
}

const UNKNOWN_OUTCOME_ERROR_CODE = "SMTP_TRANSPORT_ERROR"

export const recoverExpiredDeliveries = async (deps: RecoverExpiredDeliveriesDeps): Promise<number> => {
  const now = deps.clock()
  const unsent = await deps.unitOfWork.execute((tx) => deps.outboxRepository.recoverExpiredProcessing(tx, { now }))
  const unknown = await deps.unitOfWork.execute((tx) => deps.outboxRepository.findExpiredSending(tx, { now, limit: deps.batchLimit }))

  let recovered = unsent
  for (const attempt of unknown) {
    const delayMs = nextRetryDelayMs(attempt.attemptCount, attempt.outboxEventId)
    const resolved = await deps.unitOfWork.execute(async (tx) => {
      const delivery = await deps.emailDeliveryRepository.lockByOutboxEventId(tx, attempt.outboxEventId)
      const owned = await deps.outboxRepository.recoverUnknownSending(tx, {
        outboxEventId: attempt.outboxEventId,
        generation: attempt.generation,
        now,
        errorCode: UNKNOWN_OUTCOME_ERROR_CODE,
        resolution:
          delayMs === null
            ? { kind: "dead_letter" }
            : { kind: "retry", availableAt: new Date(now.getTime() + delayMs) },
      })
      if (!owned) return false
      if (delivery !== null) {
        await deps.emailDeliveryRepository.recordSendFailure(tx, {
          deliveryId: delivery.id,
          errorCode: UNKNOWN_OUTCOME_ERROR_CODE,
          permanent: delayMs === null,
          now,
        })
      }
      return true
    })
    if (resolved) recovered += 1
  }
  return recovered
}
