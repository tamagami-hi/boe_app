import { randomUUID } from "node:crypto"

import type { UnitOfWork } from "./db/database.js"
import type { Payment, PaymentAttempt } from "./db/repositories.js"
import type { AuditWriteRepository } from "./repositories/auditRepository.js"
import type { PaymentsRepository } from "./repositories/paymentsRepository.js"
import type {
  StaleCheckoutCandidate,
  StaleCheckoutRepository,
} from "./repositories/staleCheckoutRepository.js"

export interface StalePaymentExpiryConfig {
  readonly claimLimit: number
  readonly expiryGraceMs: number
}

export interface StalePaymentExpiryDeps {
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly staleCheckoutRepository: StaleCheckoutRepository
  readonly paymentsRepository: Pick<
    PaymentsRepository,
    "lockPaymentById" | "lockAttemptById" | "markAttemptExpired" | "markPaymentExpired"
  >
  readonly auditRepository: AuditWriteRepository
  readonly config: StalePaymentExpiryConfig
}

export interface StalePaymentExpirySummary {
  readonly staleAttemptsExpired: number
}

const isUnsettledPayment = (payment: Payment | null): payment is Payment =>
  payment !== null && payment.state === "created" && payment.succeeded_at === null

const isUndispatchedAttemptOf = (attempt: PaymentAttempt | null, paymentId: string): attempt is PaymentAttempt =>
  attempt !== null &&
  attempt.payment_id === paymentId &&
  attempt.checkout_channel === "hosted_redirect" &&
  attempt.state === "created" &&
  attempt.provider_dispatch_started_at === null

const expireCandidate = async (
  deps: StalePaymentExpiryDeps,
  candidate: StaleCheckoutCandidate,
): Promise<boolean> => {
  const now = deps.clock()
  return deps.unitOfWork.execute(async (tx) => {
    const lockedPayment = await deps.paymentsRepository.lockPaymentById(tx, candidate.paymentId)
    if (!isUnsettledPayment(lockedPayment)) return false
    const attempt = await deps.paymentsRepository.lockAttemptById(tx, candidate.attemptId)
    if (!isUndispatchedAttemptOf(attempt, lockedPayment.id)) return false
    const blocked = await deps.staleCheckoutRepository.hasLiveOrSettledSibling(tx, {
      paymentId: lockedPayment.id,
      attemptId: attempt.id,
    })
    if (blocked) return false
    if (await deps.paymentsRepository.markAttemptExpired(tx, { attemptId: attempt.id, providerState: null, now }) === null) {
      throw new Error("attempt expiry transition failed")
    }
    const payment = await deps.paymentsRepository.markPaymentExpired(tx, lockedPayment.id, now)
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
    return true
  })
}

export const runStalePaymentExpiryPass = async (
  deps: StalePaymentExpiryDeps,
): Promise<StalePaymentExpirySummary> => {
  const now = deps.clock()
  const candidates = await deps.unitOfWork.execute((tx) =>
    deps.staleCheckoutRepository.listUndispatchedExpiredCandidates(tx, {
      expiredBefore: new Date(now.getTime() - deps.config.expiryGraceMs),
      limit: deps.config.claimLimit,
    }),
  )
  let staleAttemptsExpired = 0
  for (const candidate of candidates) {
    if (await expireCandidate(deps, candidate)) staleAttemptsExpired += 1
  }
  return { staleAttemptsExpired }
}
