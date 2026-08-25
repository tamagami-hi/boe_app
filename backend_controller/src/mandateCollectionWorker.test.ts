import { describe, expect, test, vi } from "vitest"

import { reconcileCollectionFact } from "./domain/payments/reconcileCollectionFact.js"
import { runMandateCollectionPass, scheduledDebitAt, type MandateCollectionDeps } from "./mandateCollectionWorker.js"

describe("mandate collection timing", () => {
  test("rejects an uncorrelated provider collection fact without changing payment truth", async () => {
    const paymentsRepository = { markAttemptStatusChecked: vi.fn() }
    await expect(reconcileCollectionFact({} as never, {
      mandatesRepository: {
        findCollectionAttemptByMerchantOrder: vi.fn().mockResolvedValue(null),
      } as never,
      paymentsRepository: paymentsRepository as never,
    }, {
      state: "COMPLETED",
      merchantOrderId: "unknown-order",
      providerOrderId: "provider-order",
      merchantSubscriptionId: "subscription",
      amountPaise: "10000",
      expiresAt: new Date(),
      paymentDetails: [],
    }, new Date())).rejects.toThrow("collection correlation mismatch")
    expect(paymentsRepository.markAttemptStatusChecked).not.toHaveBeenCalled()
  })

  test("maps the SIP debit date to 10:00 Asia Kolkata exactly", () => {
    expect(scheduledDebitAt("2026-09-05").toISOString()).toBe("2026-09-05T04:30:00.000Z")
  })

  test("preserves the Asia Kolkata date across the UTC year boundary", () => {
    expect(scheduledDebitAt("2027-01-01").toISOString()).toBe("2027-01-01T04:30:00.000Z")
  })

  test("creates and dispatches one canonical collection at the persisted boundary", async () => {
    const now = new Date("2026-09-04T04:30:00.000Z")
    const plan = {
      id: "sip-1",
      user_id: "user-1",
      fund_id: "fund-1",
      amount_paise: "10000",
      debit_day: 5,
      duration_months: 12,
      collection_mode: "phonepe_autopay",
      state: "active",
      start_date: "2026-08-01",
      next_due_date: "2026-09-05",
    }
    const mandate = {
      id: "mandate-1",
      sip_plan_id: "sip-1",
      user_id: "user-1",
      fund_id: "fund-1",
      merchant_subscription_id: "subscription-1",
      provider_subscription_id: "provider-subscription-1",
      state: "active",
      version: "0",
    }
    const order = { id: "order-1", currency: "INR", state: "submitted" }
    const payment = { id: "payment-1" }
    const paymentAttempt = { id: "attempt-1", merchant_order_id: "merchant-order-1" }
    const collection = {
      id: "collection-1",
      user_id: "user-1",
      amount_paise: "10000",
      payment_attempt_id: "attempt-1",
      version: "0",
    }
    const notifyCollection = vi.fn().mockResolvedValue({
      providerOrderId: "provider-order-1",
      providerState: "NOTIFICATION_IN_PROGRESS",
      expiresAt: new Date("2026-09-06T04:30:00.000Z"),
    })
    const deps = {
      unitOfWork: { execute: (work: (tx: never) => unknown) => work({} as never) },
      clock: () => now,
      recurringPaymentGateway: {
        getMandateStatus: vi.fn().mockResolvedValue({
          state: "ACTIVE",
          merchantSubscriptionId: "subscription-1",
          providerSubscriptionId: "provider-subscription-1",
        }),
        notifyCollection,
      },
      sipPlanRepository: {
        listAutoPayTermCompletionCandidates: vi.fn().mockResolvedValue([]),
        listAutoPayDue: vi.fn().mockResolvedValue([plan]),
        lockById: vi.fn().mockResolvedValue(plan),
      },
      mandatesRepository: {
        findCurrentMandateForOwner: vi.fn().mockResolvedValue(mandate),
        createCollectionAttempt: vi.fn().mockResolvedValue(collection),
        claimCollectionNotification: vi.fn().mockResolvedValue({ ...collection, notify_state: "dispatching", version: "1" }),
        listCollectionReconciliationCandidates: vi.fn().mockResolvedValue([]),
      },
      orderRepository: {
        findInstallmentByPeriod: vi.fn().mockResolvedValue(null),
        latestCompliance: vi.fn().mockResolvedValue({ kycState: "approved", kycExpiresAt: null, riskState: null }),
        findFundOrderTerms: vi.fn().mockResolvedValue({ fundState: "published", fundVersionId: "version-1", currency: "INR" }),
        createSipInstallment: vi.fn().mockResolvedValue(order),
      },
      paymentsRepository: {
        markOrderPaymentPending: vi.fn().mockResolvedValue({ ...order, state: "payment_pending" }),
        createPayment: vi.fn().mockResolvedValue(payment),
        createAttempt: vi.fn().mockResolvedValue(paymentAttempt),
        markAutoPayAttemptDispatchStarted: vi.fn().mockResolvedValue({ ...paymentAttempt, provider_dispatch_started_at: now }),
        markAutoPayAttemptDispatched: vi.fn().mockResolvedValue({ ...paymentAttempt, state: "provider_pending" }),
      },
      userRepository: { lockById: vi.fn().mockResolvedValue({ id: "user-1", account_state: "active" }) },
      auditRepository: { append: vi.fn().mockResolvedValue(undefined) },
      notificationRepository: { create: vi.fn().mockResolvedValue(undefined) },
      logger: null,
      config: { claimLimit: 10, commandEnabled: true },
    } as unknown as MandateCollectionDeps
    await expect(runMandateCollectionPass(deps)).resolves.toEqual({
      plansChecked: 1,
      collectionsCreated: 1,
      notificationsDispatched: 1,
      collectionsResolved: 0,
    })
    expect(notifyCollection).toHaveBeenCalledWith({
      merchantOrderId: "merchant-order-1",
      merchantSubscriptionId: "subscription-1",
      amountPaise: "10000",
      expireAt: new Date("2026-09-06T04:30:00.000Z"),
    })
  })

  test("keeps reconciliation active while new notifications are disabled", async () => {
    const now = new Date("2026-09-06T04:30:00.000Z")
    const collection = {
      id: "collection-1",
      mandate_id: "mandate-1",
      payment_attempt_id: "attempt-1",
      amount_paise: "10000",
      notify_state: "notified",
      version: "1",
    }
    const paymentsRepository = {
      lockAttemptById: vi.fn().mockResolvedValue({ id: "attempt-1", payment_id: "payment-1", user_id: "user-1", merchant_order_id: "merchant-order-1" }),
      recordPaymentDetail: vi.fn().mockResolvedValue(undefined),
      findAttemptByMerchantOrderId: vi.fn().mockResolvedValue({ id: "attempt-1", payment_id: "payment-1", user_id: "user-1" }),
      markAttemptSucceeded: vi.fn().mockResolvedValue({ id: "attempt-1", payment_id: "payment-1" }),
      markPaymentSucceeded: vi.fn().mockResolvedValue({ id: "payment-1", order_id: "order-1" }),
      markOrderReviewPending: vi.fn().mockResolvedValue({ id: "order-1" }),
      createPendingReview: vi.fn().mockResolvedValue(undefined),
    }
    const deps = {
      unitOfWork: { execute: (work: (tx: never) => unknown) => work({} as never) },
      clock: () => now,
      recurringPaymentGateway: {
        getCollectionStatus: vi.fn().mockResolvedValue({
          state: "COMPLETED",
          merchantOrderId: "merchant-order-1",
          providerOrderId: "provider-order-1",
          merchantSubscriptionId: "subscription-1",
          amountPaise: "10000",
          expiresAt: now,
          paymentDetails: [{ transactionId: "transaction-1", state: "COMPLETED", amountPaise: "10000", instrumentType: "UPI_AUTO_PAY" }],
        }),
      },
      sipPlanRepository: {
        listAutoPayTermCompletionCandidates: vi.fn().mockResolvedValue([]),
        listAutoPayDue: vi.fn().mockResolvedValue([]),
      },
      mandatesRepository: {
        listCollectionReconciliationCandidates: vi.fn().mockResolvedValue([collection]),
        findCollectionAttemptByMerchantOrder: vi.fn().mockResolvedValue(collection),
        findMandateForAdmin: vi.fn().mockResolvedValue({ id: "mandate-1", merchant_subscription_id: "subscription-1" }),
      },
      paymentsRepository,
      logger: null,
      config: { claimLimit: 10, commandEnabled: false },
    } as unknown as MandateCollectionDeps
    await expect(runMandateCollectionPass(deps)).resolves.toEqual({
      plansChecked: 0,
      collectionsCreated: 0,
      notificationsDispatched: 0,
      collectionsResolved: 1,
    })
    expect(paymentsRepository.createPendingReview).toHaveBeenCalledOnce()
    expect(deps.sipPlanRepository.listAutoPayDue).not.toHaveBeenCalled()
  })
})
