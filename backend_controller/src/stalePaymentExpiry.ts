import { randomUUID } from "node:crypto"

import type { UnitOfWork } from "./db/database.js"
import type { AuditWriteRepository } from "./repositories/auditRepository.js"
import type { PaymentsRepository } from "./repositories/paymentsRepository.js"
import type { StaleCheckoutRepository } from "./repositories/staleCheckoutRepository.js"

export interface StalePaymentExpiryConfig {
  readonly claimLimit: number
  readonly expiryGraceMs: number
}

export interface StalePaymentExpiryDeps {
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly staleCheckoutRepository: StaleCheckoutRepository
  readonly paymentsRepository: Pick<PaymentsRepository, "markAttemptExpired" | "markPaymentExpired">
  readonly auditRepository: AuditWriteRepository
  readonly config: StalePaymentExpiryConfig
}

export interface StalePaymentExpirySummary {
  readonly staleAttemptsExpired: number
}

interface ExpiryOutcome {
  readonly attemptId: string
  readonly expired: boolean
}

const expireNextStaleAttempt = async (
  deps: StalePaymentExpiryDeps,
  excludedAttemptIds: readonly string[],
): Promise<ExpiryOutcome | null> => {
  const now = deps.clock()
  return deps.unitOfWork.execute(async (tx) => {
    const attempt = await deps.staleCheckoutRepository.lockNextUndispatchedExpiredAttempt(tx, {
      expiredBefore: new Date(now.getTime() - deps.config.expiryGraceMs),
      excludedAttemptIds,
    })
    if (attempt === null) return null
    const expiredAttempt = await deps.paymentsRepository.markAttemptExpired(tx, {
      attemptId: attempt.id,
      providerState: null,
      now,
    })
    if (expiredAttempt === null) return { attemptId: attempt.id, expired: false }
    const payment = await deps.paymentsRepository.markPaymentExpired(tx, attempt.payment_id, now)
    if (payment === null) throw new Error("payment expiry transition failed")
    await deps.auditRepository.append(tx, {
      actorType: "system",
      actorUserId: null,
      command: "payment.expire_stale_checkout",
      entityType: "payment",
      entityId: payment.id,
      fromState: "created",
      toState: "expired",
      requestId: randomUUID(),
      entityVersion: Number(payment.version),
      metadata: {
        attemptId: attempt.id,
        orderId: payment.order_id,
        checkoutExpiresAt: new Date(attempt.checkout_expires_at as Date | string).toISOString(),
        reason: "payment_gateway_not_configured",
      },
    })
    return { attemptId: attempt.id, expired: true }
  })
}

export const runStalePaymentExpiryPass = async (
  deps: StalePaymentExpiryDeps,
): Promise<StalePaymentExpirySummary> => {
  let excludedAttemptIds: readonly string[] = []
  let staleAttemptsExpired = 0
  while (excludedAttemptIds.length < deps.config.claimLimit) {
    const outcome = await expireNextStaleAttempt(deps, excludedAttemptIds)
    if (outcome === null) break
    excludedAttemptIds = [...excludedAttemptIds, outcome.attemptId]
    if (outcome.expired) staleAttemptsExpired += 1
  }
  return { staleAttemptsExpired }
}
