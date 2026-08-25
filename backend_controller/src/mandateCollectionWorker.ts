import { randomUUID } from "node:crypto"

import type { UnitOfWork } from "./db/database.js"
import type { SipPlan } from "./db/repositories.js"
import { createSipInstallmentOrder } from "./domain/client/createSipInstallmentOrder.js"
import { reconcileCollectionFact } from "./domain/payments/reconcileCollectionFact.js"
import { applyCanonicalPaymentOutcome } from "./domain/payments/applyCanonicalPaymentOutcome.js"
import { reconcileMandateFact } from "./domain/payments/reconcileMandateFacts.js"
import { newMerchantOrderId } from "./domain/payments/merchantIds.js"
import type { RecurringPaymentGateway } from "./providers/recurringPaymentGateway.js"
import { logGatewayFailure, type GatewayFailureLogger } from "./providers/phonepe/gatewayFailure.js"
import type { AuditWriteRepository } from "./repositories/auditRepository.js"
import type { MandatesRepository } from "./repositories/mandatesRepository.js"
import type { NotificationWriteRepository } from "./repositories/notificationRepository.js"
import type { OrderWriteRepository } from "./repositories/orderRepository.js"
import type { PaymentsRepository } from "./repositories/paymentsRepository.js"
import type { SipPlanRepository } from "./repositories/sipPlanRepository.js"
import type { UserWriteRepository } from "./repositories/userRepository.js"

const HOUR_MS = 3_600_000
const NOTIFY_LEAD_MS = 24 * HOUR_MS
const COLLECTION_EXPIRY_MS = 48 * HOUR_MS
const IST_OFFSET_MS = 5.5 * HOUR_MS
const DEBIT_HOUR_IST = 10

export interface MandateCollectionConfig {
  readonly claimLimit: number
  readonly commandEnabled: boolean
}

export interface MandateCollectionDeps {
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly recurringPaymentGateway: RecurringPaymentGateway
  readonly sipPlanRepository: SipPlanRepository
  readonly mandatesRepository: MandatesRepository
  readonly orderRepository: OrderWriteRepository
  readonly paymentsRepository: PaymentsRepository
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
}

export const scheduledDebitAt = (dueDate: Date | string): Date => {
  const value = typeof dueDate === "string" ? dueDate.slice(0, 10) : dueDate.toISOString().slice(0, 10)
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  return new Date(Date.UTC(year, month - 1, day, DEBIT_HOUR_IST) - IST_OFFSET_MS)
}

const dateInIndia = (value: Date): string => new Date(value.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)

const firstOfMonth = (value: Date | string): string => {
  const date = typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10)
  return `${date.slice(0, 7)}-01`
}

const nextMonthlyDueDate = (dueDate: Date | string, debitDay: number): string => {
  const value = typeof dueDate === "string" ? dueDate.slice(0, 10) : dueDate.toISOString().slice(0, 10)
  const [year, month] = value.split("-").map(Number)
  const first = new Date(Date.UTC(year as number, month as number, 1))
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(debitDay, lastDay))).toISOString().slice(0, 10)
}

const prepareCollection = async (deps: MandateCollectionDeps, plan: SipPlan) => {
  const now = deps.clock()
  return deps.unitOfWork.execute(async (tx) => {
    const locked = await deps.sipPlanRepository.lockById(tx, { sipPlanId: plan.id, userId: plan.user_id })
    if (locked === null || locked.state !== "active" || locked.collection_mode !== "phonepe_autopay" || locked.next_due_date === null) return null
    const debitAt = scheduledDebitAt(locked.next_due_date)
    const notifyAt = new Date(debitAt.getTime() - NOTIFY_LEAD_MS)
    if (now < notifyAt || now >= debitAt) return null
    const mandate = await deps.mandatesRepository.findCurrentMandateForOwner(tx, { sipPlanId: locked.id, userId: locked.user_id })
    if (mandate === null || mandate.state !== "active" || mandate.provider_subscription_id === null) return null
    const duePeriod = firstOfMonth(locked.next_due_date)
    const existing = await deps.orderRepository.findInstallmentByPeriod(tx, { sipPlanId: locked.id, duePeriod })
    if (existing !== null) {
      if (existing.state === "accepted") {
        await deps.sipPlanRepository.advanceNextDueDate(tx, {
          sipPlanId: locked.id,
          nextDueDate: nextMonthlyDueDate(locked.next_due_date, locked.debit_day),
          now,
        })
      }
      return null
    }
    const created = await createSipInstallmentOrder(tx, {
      orderRepository: deps.orderRepository,
      userRepository: deps.userRepository,
      auditRepository: deps.auditRepository,
      notificationRepository: deps.notificationRepository,
      clock: deps.clock,
    }, { plan: locked, duePeriod, requestId: `autopay-${locked.id}-${duePeriod}` })
    if (created.outcome !== "created") return null
    if (await deps.paymentsRepository.markOrderPaymentPending(tx, created.order.id, now) === null) return null
    const payment = await deps.paymentsRepository.createPayment(tx, {
      orderId: created.order.id,
      userId: locked.user_id,
      amountPaise: locked.amount_paise,
      currency: created.order.currency,
    })
    const merchantOrderId = newMerchantOrderId()
    const expiresAt = new Date(notifyAt.getTime() + COLLECTION_EXPIRY_MS)
    const paymentAttempt = await deps.paymentsRepository.createAttempt(tx, {
      paymentId: payment.id,
      userId: locked.user_id,
      attemptNumber: 1,
      merchantOrderId,
      checkoutExpiresAt: expiresAt,
      checkoutChannel: "phonepe_autopay",
    })
    const collection = await deps.mandatesRepository.createCollectionAttempt(tx, {
      mandateId: mandate.id,
      sipPlanId: locked.id,
      userId: locked.user_id,
      fundId: locked.fund_id,
      amountPaise: locked.amount_paise,
      duePeriod,
      scheduledDebitAt: debitAt,
      notifyAt,
      orderId: created.order.id,
      paymentId: payment.id,
      paymentAttemptId: paymentAttempt.id,
    })
    return { collection, mandate, paymentAttempt, expiresAt }
  })
}

const dispatchCollection = async (deps: MandateCollectionDeps, prepared: NonNullable<Awaited<ReturnType<typeof prepareCollection>>>): Promise<boolean> => {
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
        }, deps.clock())
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
    logGatewayFailure(deps.logger, error, { requestId: randomUUID(), operation: "notify_collection" })
    return false
  }
}

const reconcileCollections = async (deps: MandateCollectionDeps): Promise<number> => {
  const candidates = await deps.unitOfWork.execute((tx) => deps.mandatesRepository.listCollectionReconciliationCandidates(tx, deps.config.claimLimit))
  let resolved = 0
  for (const collection of candidates) {
    try {
      const attempt = await deps.unitOfWork.execute((tx) => deps.paymentsRepository.lockAttemptById(tx, collection.payment_attempt_id))
      if (attempt === null) continue
      const fact = await deps.recurringPaymentGateway.getCollectionStatus(attempt.merchant_order_id)
      if (await deps.unitOfWork.execute((tx) => reconcileCollectionFact(tx, deps, fact, deps.clock()))) resolved += 1
    } catch (error) {
      logGatewayFailure(deps.logger, error, { requestId: randomUUID(), operation: "get_collection_status" })
    }
  }
  return resolved
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
    collectionsCreated += 1
    if (await dispatchCollection(deps, prepared)) notificationsDispatched += 1
  }
  const collectionsResolved = await reconcileCollections(deps)
  return { plansChecked: plans.length, collectionsCreated, notificationsDispatched, collectionsResolved }
}
