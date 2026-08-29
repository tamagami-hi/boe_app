import { describe, expect, test, vi } from "vitest"

import type { PaymentAttempt, Transaction } from "./db/repositories.js"
import { runReconciliationPass, type PaymentReconciliationDeps } from "./paymentReconciliationWorker.js"
import {
  GatewayNotFoundError,
  GatewayThrottledError,
  type PaymentGateway,
} from "./providers/phonepe/paymentGateway.js"
import type { PaymentsRepository } from "./repositories/paymentsRepository.js"
import type { RefundRepository } from "./repositories/refundRepository.js"

const NOW = new Date("2026-08-25T12:00:00.000Z")
const ATTEMPT_ID = "00000000-0000-4000-8000-000000000001"
const PAYMENT_ID = "00000000-0000-4000-8000-000000000002"
const MERCHANT_ORDER_ID = "BOE_RECONCILIATION_ORDER"

const createAttempt = (overrides: Partial<PaymentAttempt> = {}): PaymentAttempt => ({
  id: ATTEMPT_ID,
  payment_id: PAYMENT_ID,
  merchant_order_id: MERCHANT_ORDER_ID,
  checkout_expires_at: new Date("2026-08-25T11:00:00.000Z"),
  reconciliation_failure_count: 0,
  ...overrides,
} as PaymentAttempt)

const createDeps = (input: Readonly<{
  attempt: PaymentAttempt
  getOrderStatus: PaymentGateway["getOrderStatus"]
  succeededAt?: Date | null
  config?: Partial<PaymentReconciliationDeps["config"]>
}>) => {
  const lockAttemptsForReconciliation = vi.fn()
    .mockResolvedValueOnce([input.attempt])
    .mockResolvedValueOnce([])
  const markReconciliationRequired = vi.fn().mockResolvedValue(input.attempt)
  const rescheduleAttemptReconciliation = vi.fn().mockResolvedValue(input.attempt)
  const markAttemptExpired = vi.fn().mockResolvedValue(input.attempt)
  const markPaymentExpired = vi.fn().mockResolvedValue({ id: PAYMENT_ID })
  const paymentsRepository = {
    lockAttemptsForReconciliation,
    markReconciliationRequired,
    rescheduleAttemptReconciliation,
    lockPaymentById: vi.fn().mockResolvedValue({
      id: PAYMENT_ID,
      succeeded_at: input.succeededAt ?? null,
    }),
    markAttemptExpired,
    markPaymentExpired,
  } as unknown as PaymentsRepository
  const refundRepository = {
    lockDueRefunds: vi.fn().mockResolvedValue([]),
  } as unknown as RefundRepository
  const deps = {
    unitOfWork: {
      execute: <Result>(operation: (tx: Transaction) => Promise<Result>): Promise<Result> =>
        operation({} as Transaction),
    },
    clock: () => NOW,
    paymentGateway: { getOrderStatus: input.getOrderStatus } as PaymentGateway,
    paymentsRepository,
    refundRepository,
    logger: null,
    config: {
      claimLimit: 2,
      notFoundGraceMs: 300_000,
      leaseMs: 60_000,
      pendingIntervalMs: 30_000,
      maxBackoffMs: 900_000,
      ...input.config,
    },
  } as PaymentReconciliationDeps
  return {
    deps,
    lockAttemptsForReconciliation,
    markReconciliationRequired,
    rescheduleAttemptReconciliation,
    markAttemptExpired,
    markPaymentExpired,
  }
}

describe("runReconciliationPass", () => {
  test("moves a persistently pending post-expiry payment to reconciliation required", async () => {
    const harness = createDeps({
      attempt: createAttempt(),
      getOrderStatus: vi.fn().mockResolvedValue({
        merchantOrderId: MERCHANT_ORDER_ID,
        outcome: "pending",
        providerState: "PENDING",
        providerOrderId: "OMO_PROVIDER_ORDER",
        amountPaise: "1000000",
        currency: "INR",
        details: [],
      }),
    })

    const summary = await runReconciliationPass(harness.deps)

    expect(summary).toEqual({
      attemptsChecked: 1,
      attemptsResolved: 1,
      refundsChecked: 0,
      refundsResolved: 0,
    })
    expect(harness.markReconciliationRequired).toHaveBeenCalledWith(
      expect.anything(),
      {
        attemptId: ATTEMPT_ID,
        paymentId: PAYMENT_ID,
        providerState: "PENDING",
        now: NOW,
      },
    )
    expect(harness.rescheduleAttemptReconciliation).not.toHaveBeenCalled()
  })

  test("backs off a throttled status check without resolving the payment", async () => {
    const harness = createDeps({
      attempt: createAttempt({
        checkout_expires_at: new Date("2026-08-25T12:10:00.000Z"),
        reconciliation_failure_count: 2,
      }),
      getOrderStatus: vi.fn().mockRejectedValue(new GatewayThrottledError("rate limited")),
    })

    const summary = await runReconciliationPass(harness.deps)

    expect(summary.attemptsResolved).toBe(0)
    expect(harness.rescheduleAttemptReconciliation).toHaveBeenCalledWith(
      expect.anything(),
      {
        attemptId: ATTEMPT_ID,
        now: NOW,
        nextCheckAt: new Date("2026-08-25T12:04:00.000Z"),
        isFailure: true,
      },
    )
    expect(harness.markReconciliationRequired).not.toHaveBeenCalled()
  })

  test.each([
    {
      name: "expired provider state",
      getOrderStatus: vi.fn().mockResolvedValue({
        merchantOrderId: MERCHANT_ORDER_ID,
        outcome: "pending",
        providerState: "EXPIRED",
        providerOrderId: "OMO_PROVIDER_ORDER",
        amountPaise: "1000000",
        currency: "INR",
        details: [],
      }),
      providerState: "EXPIRED",
    },
    {
      name: "post-grace provider 404",
      getOrderStatus: vi.fn().mockRejectedValue(new GatewayNotFoundError("not found")),
      providerState: "NOT_FOUND",
    },
  ])("quarantines a previously succeeded payment on $name", async ({ getOrderStatus, providerState }) => {
    const harness = createDeps({
      attempt: createAttempt(),
      getOrderStatus,
      succeededAt: new Date("2026-08-25T10:00:00.000Z"),
    })

    const summary = await runReconciliationPass(harness.deps)

    expect(summary.attemptsResolved).toBe(1)
    expect(harness.markReconciliationRequired).toHaveBeenCalledWith(expect.anything(), {
      attemptId: ATTEMPT_ID,
      paymentId: PAYMENT_ID,
      providerState,
      now: NOW,
    })
    expect(harness.markAttemptExpired).not.toHaveBeenCalled()
    expect(harness.markPaymentExpired).not.toHaveBeenCalled()
  })

  test("re-checks a freshly dispatched pending attempt after one second", async () => {
    const harness = createDeps({
      attempt: createAttempt({
        checkout_expires_at: new Date("2026-08-25T12:13:00.000Z"),
        provider_dispatch_started_at: new Date("2026-08-25T11:59:55.000Z"),
      }),
      config: { fastIntervalMs: 1_000, fastWindowMs: 180_000 },
      getOrderStatus: vi.fn().mockResolvedValue({
        merchantOrderId: MERCHANT_ORDER_ID,
        outcome: "pending",
        providerState: "PENDING",
        providerOrderId: "OMO_PROVIDER_ORDER",
        amountPaise: "100",
        currency: "INR",
        details: [],
      }),
    })

    const summary = await runReconciliationPass(harness.deps)

    expect(summary.attemptsResolved).toBe(0)
    expect(harness.rescheduleAttemptReconciliation).toHaveBeenCalledWith(expect.anything(), {
      attemptId: ATTEMPT_ID,
      now: NOW,
      nextCheckAt: new Date("2026-08-25T12:00:01.000Z"),
      isFailure: false,
    })
  })

  test("does not park a live checkout behind a long backoff after repeated gateway errors", async () => {    const harness = createDeps({
      attempt: createAttempt({
        checkout_expires_at: new Date("2026-08-25T12:13:00.000Z"),
        provider_dispatch_started_at: new Date("2026-08-25T11:59:55.000Z"),
        reconciliation_failure_count: 8,
      }),
      config: { fastIntervalMs: 1_000, fastWindowMs: 180_000 },
      getOrderStatus: vi.fn().mockRejectedValue(new Error("relay unreachable")),
    })

    const summary = await runReconciliationPass(harness.deps)

    expect(summary.attemptsResolved).toBe(0)
    expect(harness.rescheduleAttemptReconciliation).toHaveBeenCalledWith(expect.anything(), {
      attemptId: ATTEMPT_ID,
      now: NOW,
      nextCheckAt: new Date("2026-08-25T12:00:30.000Z"),
      isFailure: true,
    })
  })

  test("quarantines a long-expired attempt the gateway will never answer for", async () => {
    const harness = createDeps({
      attempt: createAttempt({
        checkout_expires_at: new Date("2026-08-25T10:00:00.000Z"),
        provider_dispatch_started_at: new Date("2026-08-25T09:45:00.000Z"),
        reconciliation_failure_count: 38,
      }),
      config: { quarantineFailureThreshold: 5 },
      getOrderStatus: vi.fn().mockRejectedValue(new Error("request rejected")),
    })

    const summary = await runReconciliationPass(harness.deps)

    expect(summary.attemptsResolved).toBe(1)
    expect(harness.markReconciliationRequired).toHaveBeenCalledWith(expect.anything(), {
      attemptId: ATTEMPT_ID,
      paymentId: PAYMENT_ID,
      providerState: "STATUS_UNAVAILABLE",
      now: NOW,
    })
    expect(harness.rescheduleAttemptReconciliation).not.toHaveBeenCalled()
  })

  test("keeps retrying an expired attempt until the quarantine threshold is reached", async () => {
    const harness = createDeps({
      attempt: createAttempt({
        checkout_expires_at: new Date("2026-08-25T10:00:00.000Z"),
        provider_dispatch_started_at: new Date("2026-08-25T09:45:00.000Z"),
        reconciliation_failure_count: 4,
      }),
      config: { quarantineFailureThreshold: 5 },
      getOrderStatus: vi.fn().mockRejectedValue(new Error("request rejected")),
    })

    const summary = await runReconciliationPass(harness.deps)

    expect(summary.attemptsResolved).toBe(0)
    expect(harness.markReconciliationRequired).not.toHaveBeenCalled()
    expect(harness.rescheduleAttemptReconciliation).toHaveBeenCalledOnce()
  })
})
