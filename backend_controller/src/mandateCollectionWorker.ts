import { randomUUID } from "node:crypto"

import type { UnitOfWork } from "./db/database.js"
import type { InvestmentOrder, MandateCollectionAttempt, PaymentAttempt, PaymentMandate, SipPlan, Transaction } from "./db/repositories.js"
import { createSipInstallmentOrder } from "./domain/client/createSipInstallmentOrder.js"
import { isInstallmentPeriodResolved } from "./domain/client/sipInstallmentPeriod.js"
import { reconcileCollectionFact } from "./domain/payments/reconcileCollectionFact.js"
import { applyCanonicalPaymentOutcome } from "./domain/payments/applyCanonicalPaymentOutcome.js"
import { reconcileMandateFact } from "./domain/payments/reconcileMandateFacts.js"
import { newMerchantOrderId } from "./domain/payments/merchantIds.js"
import type { RecurringPaymentGateway } from "./providers/recurringPaymentGateway.js"
import { logGatewayFailure, type GatewayFailureLogger } from "./providers/gatewayFailure.js"
import { GatewayRejectedError } from "./providers/paymentGateway.js"
import type { AuditWriteRepository } from "./repositories/auditRepository.js"
import type { MandatesRepository } from "./repositories/mandatesRepository.js"
import type { NotificationWriteRepository } from "./repositories/notificationRepository.js"
import type { OrderWriteRepository } from "./repositories/orderRepository.js"
import type { PaymentsRepository } from "./repositories/paymentsRepository.js"
import type { InvestmentSettlementRepository } from "./repositories/investmentSettlementRepository.js"
import type { SipPlanRepository } from "./repositories/sipPlanRepository.js"
import type { UserWriteRepository } from "./repositories/userRepository.js"

const HOUR_MS = 3_600_000
const NOTIFY_LEAD_MS = 24 * HOUR_MS
const COLLECTION_EXPIRY_MS = 48 * HOUR_MS
const IST_OFFSET_MS = 5.5 * HOUR_MS
const DEBIT_HOUR_IST = 10
const COLLECTION_EXPIRED_CODE = "COLLECTION_EXPIRED"
const MISSED_PERIOD_REASON = "no_installment_by_debit_time"

export interface MandateCollectionConfig {
  readonly merchantService: string | null
  readonly claimLimit: number
  readonly commandEnabled: boolean
  readonly expiryGraceMs: number
}

export interface MandateCollectionDeps {
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly recurringPaymentGateway: RecurringPaymentGateway
  readonly sipPlanRepository: SipPlanRepository
  readonly mandatesRepository: MandatesRepository
  readonly orderRepository: OrderWriteRepository
  readonly paymentsRepository: PaymentsRepository
  readonly settlementRepository: InvestmentSettlementRepository
  readonly userRepository: UserWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly notificationRepository: NotificationWriteRepository
  readonly logger: GatewayFailureLogger | null
  readonly config: MandateCollectionConfig
}

export interface MandateCollectionSummary {
  readonly plansChecked: number
  readonly collectionsCreated: number
  readonly notificationsDispatched: number
  readonly collectionsResolved: number
  readonly collectionsExpired: number
}

type CollectionStep =
  | {
    readonly kind: "prepared"
    readonly collection: MandateCollectionAttempt
    readonly mandate: PaymentMandate
    readonly paymentAttempt: PaymentAttempt
    readonly expiresAt: Date
  }
  | { readonly kind: "skipped"; readonly duePeriod: string }
  | { readonly kind: "not_created"; readonly duePeriod: string; readonly reason: string }

type PreparedCollection = Extract<CollectionStep, { kind: "prepared" }>

const isoDate = (value: Date | string): string => typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10)

export const scheduledDebitAt = (dueDate: Date | string): Date => {
  const value = isoDate(dueDate)
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  return new Date(Date.UTC(year, month - 1, day, DEBIT_HOUR_IST) - IST_OFFSET_MS)
}

const dateInIndia = (value: Date): string => new Date(value.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)

const firstOfMonth = (value: Date | string): string => `${isoDate(value).slice(0, 7)}-01`

const nextMonthlyDueDate = (dueDate: Date | string, debitDay: number): string => {
  const [year, month] = isoDate(dueDate).split("-").map(Number)
  const first = new Date(Date.UTC(year as number, month as number, 1))
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(debitDay, lastDay))).toISOString().slice(0, 10)
}

const advancePastPeriod = async (
  tx: Transaction,
  deps: MandateCollectionDeps,
  input: Readonly<{ plan: SipPlan; dueDate: string; duePeriod: string; isMissed: boolean; now: Date }>,
): Promise<CollectionStep | null> => {
  const advanced = await deps.sipPlanRepository.advanceNextDueDate(tx, {
    sipPlanId: input.plan.id,
    expectedNextDueDate: input.dueDate,
    nextDueDate: nextMonthlyDueDate(input.dueDate, input.plan.debit_day),
    now: input.now,
  })
  if (advanced === null || !input.isMissed) return null
  await deps.auditRepository.append(tx, {
    actorType: "system",
    actorUserId: null,
    command: "sip.period.skip",
    entityType: "sip_plan",
    entityId: input.plan.id,
    requestId: randomUUID(),
    entityVersion: Number(advanced.version),
    metadata: { duePeriod: input.duePeriod, reason: MISSED_PERIOD_REASON },
  })
  return { kind: "skipped", duePeriod: input.duePeriod }
}

const openCollection = async (
  tx: Transaction,
  deps: MandateCollectionDeps,
  input: Readonly<{ plan: SipPlan; mandate: PaymentMandate; order: InvestmentOrder; duePeriod: string; debitAt: Date; notifyAt: Date; now: Date }>,
): Promise<CollectionStep | null> => {
  if (await deps.paymentsRepository.markOrderPaymentPending(tx, input.order.id, input.now) === null) return null
  const payment = await deps.paymentsRepository.createPayment(tx, {
    orderId: input.order.id,
    userId: input.plan.user_id,
    amountPaise: input.plan.amount_paise,
    currency: input.order.currency,
  })
  const expiresAt = new Date(input.notifyAt.getTime() + COLLECTION_EXPIRY_MS)
  const paymentAttempt = await deps.paymentsRepository.createAttempt(tx, {
    paymentId: payment.id,
    userId: input.plan.user_id,
    attemptNumber: 1,
    merchantOrderId: newMerchantOrderId(deps.config.merchantService),
    checkoutExpiresAt: expiresAt,
    checkoutChannel: "phonepe_autopay",
  })
  const collection = await deps.mandatesRepository.createCollectionAttempt(tx, {
    mandateId: input.mandate.id,
    sipPlanId: input.plan.id,
    userId: input.plan.user_id,
    fundId: input.plan.fund_id,
    amountPaise: input.plan.amount_paise,
    duePeriod: input.duePeriod,
    scheduledDebitAt: input.debitAt,
    notifyAt: input.notifyAt,
    orderId: input.order.id,
    paymentId: payment.id,
    paymentAttemptId: paymentAttempt.id,
  })
  return { kind: "prepared", collection, mandate: input.mandate, paymentAttempt, expiresAt }
}

const prepareCollection = async (deps: MandateCollectionDeps, plan: SipPlan): Promise<CollectionStep | null> => {
  const now = deps.clock()
  return deps.unitOfWork.execute(async (tx) => {
    const locked = await deps.sipPlanRepository.lockById(tx, { sipPlanId: plan.id, userId: plan.user_id })
    if (locked === null || locked.state !== "active" || locked.collection_mode !== "phonepe_autopay" || locked.next_due_date === null) return null
    const dueDate = isoDate(locked.next_due_date)
    const debitAt = scheduledDebitAt(dueDate)
    const notifyAt = new Date(debitAt.getTime() - NOTIFY_LEAD_MS)
    const duePeriod = firstOfMonth(dueDate)
    const existing = await deps.orderRepository.findInstallmentByPeriod(tx, { sipPlanId: locked.id, duePeriod })
    const isPeriodResolved = existing === null ? now >= debitAt : isInstallmentPeriodResolved(existing.state)
    if (isPeriodResolved) {
      return advancePastPeriod(tx, deps, { plan: locked, dueDate, duePeriod, isMissed: existing === null, now })
    }
    if (existing !== null || now < notifyAt) return null
    const mandate = await deps.mandatesRepository.findCurrentMandateForOwner(tx, { sipPlanId: locked.id, userId: locked.user_id })
    if (mandate === null || mandate.state !== "active" || mandate.provider_subscription_id === null) return null
    const created = await createSipInstallmentOrder(tx, {
      orderRepository: deps.orderRepository,
      userRepository: deps.userRepository,
      auditRepository: deps.auditRepository,
      notificationRepository: deps.notificationRepository,
      clock: deps.clock,
    }, { plan: locked, duePeriod, requestId: randomUUID() })
    if (created.outcome !== "created") return { kind: "not_created", duePeriod, reason: created.outcome }
    return openCollection(tx, deps, { plan: locked, mandate, order: created.order, duePeriod, debitAt, notifyAt, now })
  })
}

const logUncollectedPeriod = (
  deps: MandateCollectionDeps,
  plan: SipPlan,
  step: Exclude<CollectionStep, PreparedCollection>,
): void => {
  if (step.kind === "skipped") {
    deps.logger?.warn(
      { errorCode: "SIP_PERIOD_SKIPPED", sipPlanId: plan.id, duePeriod: step.duePeriod, reason: MISSED_PERIOD_REASON },
      "AutoPay SIP period passed its debit time with no instalment and was skipped",
    )
    return
  }
  deps.logger?.warn(
    { errorCode: "SIP_INSTALLMENT_NOT_CREATED", sipPlanId: plan.id, duePeriod: step.duePeriod, reason: step.reason },
    "AutoPay SIP instalment was not created for this period",
  )
}

const failRejectedCollectionNotification = async (
  deps: MandateCollectionDeps,
  input: Readonly<{ paymentAttemptId: string; expectedVersion: string; merchantOrderId: string }>,
): Promise<void> => deps.unitOfWork.execute(async (tx) => {
  const failed = await deps.mandatesRepository.applyProviderNotificationOutcome(tx, {
    paymentAttemptId: input.paymentAttemptId,
    expectedVersion: input.expectedVersion,
    toState: "failed",
    failureCode: "PROVIDER_REJECTED",
    now: deps.clock(),
  })
  if (failed === null) return
  await applyCanonicalPaymentOutcome(tx, deps.paymentsRepository, {
    merchantOrderId: input.merchantOrderId,
    providerMerchantOrderId: input.merchantOrderId,
    outcome: "failed",
    providerState: "PROVIDER_REJECTED",
    providerOrderId: null,
    amountPaise: null,
    currency: "INR",
    details: [],
  }, deps.clock(), deps.settlementRepository)
})

const dispatchCollection = async (deps: MandateCollectionDeps, prepared: PreparedCollection): Promise<boolean> => {
  try {
    const status = await deps.recurringPaymentGateway.getMandateStatus(prepared.mandate.merchant_subscription_id)
    if (status.state !== "ACTIVE" || status.providerSubscriptionId !== prepared.mandate.provider_subscription_id) {
      await reconcileMandateFact(deps, status, deps.clock())
      await deps.unitOfWork.execute(async (tx) => {
        const failed = await deps.mandatesRepository.failCollectionBeforeNotify(tx, {
          attemptId: prepared.collection.id,
          expectedVersion: prepared.collection.version,
          failureCode: "MANDATE_INACTIVE",
          now: deps.clock(),
        })
        if (failed === null) return
        await applyCanonicalPaymentOutcome(tx, deps.paymentsRepository, {
          merchantOrderId: prepared.paymentAttempt.merchant_order_id,
          providerMerchantOrderId: prepared.paymentAttempt.merchant_order_id,
          outcome: "failed",
          providerState: "MANDATE_INACTIVE",
          providerOrderId: null,
          amountPaise: null,
          currency: "INR",
          details: [],
        }, deps.clock(), deps.settlementRepository)
      })
      return false
    }
    const claimed = await deps.unitOfWork.execute(async (tx) => {
      const collection = await deps.mandatesRepository.claimCollectionNotification(tx, {
        attemptId: prepared.collection.id,
        userId: prepared.collection.user_id,
        expectedVersion: prepared.collection.version,
        fromState: "created",
        now: deps.clock(),
      })
      if (collection === null) return null
      const attempt = await deps.paymentsRepository.markAutoPayAttemptDispatchStarted(tx, collection.payment_attempt_id, deps.clock())
      return attempt === null ? null : collection
    })
    if (claimed === null) return false
    try {
      const result = await deps.recurringPaymentGateway.notifyCollection({
        merchantOrderId: prepared.paymentAttempt.merchant_order_id,
        merchantSubscriptionId: prepared.mandate.merchant_subscription_id,
        amountPaise: prepared.collection.amount_paise,
        expireAt: prepared.expiresAt,
      })
      const dispatched = await deps.unitOfWork.execute((tx) => deps.paymentsRepository.markAutoPayAttemptDispatched(tx, {
        attemptId: prepared.paymentAttempt.id,
        providerOrderId: result.providerOrderId,
        checkoutExpiresAt: result.expiresAt,
        now: deps.clock(),
      }))
      if (dispatched === null) return false
      return true
    } catch (error) {
      if (error instanceof GatewayRejectedError) {
        await failRejectedCollectionNotification(deps, {
          paymentAttemptId: claimed.payment_attempt_id,
          expectedVersion: claimed.version,
          merchantOrderId: prepared.paymentAttempt.merchant_order_id,
        })
      }
      throw error
    }
  } catch (error) {
    logGatewayFailure(deps.logger, error, { requestId: randomUUID(), operation: "notify_collection" })
    return false
  }
}

const isCollectionPastExpiry = (
  attempt: PaymentAttempt,
  now: Date,
  expiryGraceMs: number,
): boolean => {
  if (attempt.checkout_expires_at === null) return false
  const expiresAtMs = new Date(attempt.checkout_expires_at).getTime()
  if (!Number.isFinite(expiresAtMs)) return false
  return now.getTime() > expiresAtMs + expiryGraceMs
}

const expireStaleCollection = async (
  deps: MandateCollectionDeps,
  collection: MandateCollectionAttempt,
  attempt: PaymentAttempt,
): Promise<boolean> => deps.unitOfWork.execute(async (tx) => {
  const now = deps.clock()
  if (collection.notify_state === "dispatching") {
    const failed = await deps.mandatesRepository.applyProviderNotificationOutcome(tx, {
      paymentAttemptId: collection.payment_attempt_id,
      expectedVersion: collection.version,
      toState: "failed",
      failureCode: COLLECTION_EXPIRED_CODE,
      now,
    })
    if (failed === null) return false
  }
  const expired = await deps.paymentsRepository.markAttemptExpired(tx, {
    attemptId: attempt.id,
    providerState: COLLECTION_EXPIRED_CODE,
    now,
  })
  if (expired === null) return false
  await deps.paymentsRepository.markPaymentExpired(tx, attempt.payment_id, now)
  await deps.paymentsRepository.markOrderPaymentFailed(tx, {
    orderId: collection.order_id,
    failureCode: COLLECTION_EXPIRED_CODE,
    now,
  })
  return true
})

const reconcileCollections = async (
  deps: MandateCollectionDeps,
): Promise<{ resolved: number; expired: number }> => {
  const candidates = await deps.unitOfWork.execute((tx) => deps.mandatesRepository.listCollectionReconciliationCandidates(tx, deps.config.claimLimit))
  let resolved = 0
  let expired = 0
  for (const collection of candidates) {
    try {
      const attempt = await deps.unitOfWork.execute((tx) => deps.paymentsRepository.lockAttemptById(tx, collection.payment_attempt_id))
      if (attempt === null) continue
      if (isCollectionPastExpiry(attempt, deps.clock(), deps.config.expiryGraceMs)) {
        if (await expireStaleCollection(deps, collection, attempt)) expired += 1
        continue
      }
      const fact = await deps.recurringPaymentGateway.getCollectionStatus(attempt.merchant_order_id)
      if (await deps.unitOfWork.execute((tx) => reconcileCollectionFact(tx, deps, fact, deps.clock()))) resolved += 1
    } catch (error) {
      logGatewayFailure(deps.logger, error, { requestId: randomUUID(), operation: "get_collection_status" })
    }
  }
  return { resolved, expired }
}

const confirmActiveBeforeCollectionCreation = async (deps: MandateCollectionDeps, plan: SipPlan): Promise<boolean> => {
  const mandate = await deps.unitOfWork.execute((tx) =>
    deps.mandatesRepository.findCurrentMandateForOwner(tx, { sipPlanId: plan.id, userId: plan.user_id }))
  if (mandate === null || mandate.state !== "active" || mandate.provider_subscription_id === null) return false
  try {
    const status = await deps.recurringPaymentGateway.getMandateStatus(mandate.merchant_subscription_id)
    if (status.state === "ACTIVE" && status.providerSubscriptionId === mandate.provider_subscription_id) return true
    await reconcileMandateFact(deps, status, deps.clock())
    return false
  } catch (error) {
    logGatewayFailure(deps.logger, error, { requestId: randomUUID(), operation: "precheck_collection_mandate" })
    return false
  }
}

export const runMandateCollectionPass = async (deps: MandateCollectionDeps): Promise<MandateCollectionSummary> => {
  const now = deps.clock()
  const completionCandidates = await deps.unitOfWork.execute((tx) =>
    deps.sipPlanRepository.listAutoPayTermCompletionCandidates(tx, deps.config.claimLimit))
  for (const plan of completionCandidates) {
    await deps.unitOfWork.execute((tx) => deps.mandatesRepository.requestTermCompletion(tx, { sipPlanId: plan.id, now }))
  }
  const horizon = dateInIndia(new Date(now.getTime() + NOTIFY_LEAD_MS))
  const plans = deps.config.commandEnabled
    ? await deps.unitOfWork.execute((tx) => deps.sipPlanRepository.listAutoPayDue(tx, { asOf: horizon, limit: deps.config.claimLimit }))
    : []
  let collectionsCreated = 0
  let notificationsDispatched = 0
  for (const plan of plans) {
    if (!await confirmActiveBeforeCollectionCreation(deps, plan)) continue
    const prepared = await prepareCollection(deps, plan)
    if (prepared === null) continue
    if (prepared.kind !== "prepared") {
      logUncollectedPeriod(deps, plan, prepared)
      continue
    }
    collectionsCreated += 1
    if (await dispatchCollection(deps, prepared)) notificationsDispatched += 1
  }
  const collections = await reconcileCollections(deps)
  return {
    plansChecked: plans.length,
    collectionsCreated,
    notificationsDispatched,
    collectionsResolved: collections.resolved,
    collectionsExpired: collections.expired,
  }
}
