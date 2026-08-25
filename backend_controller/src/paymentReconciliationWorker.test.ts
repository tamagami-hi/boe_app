import { describe, expect, test, vi } from "vitest"

import type { PaymentAttempt, Transaction } from "./db/repositories.js"
import { runReconciliationPass, type PaymentReconciliationDeps } from "./paymentReconciliationWorker.js"
import { GatewayThrottledError, type PaymentGateway } from "./providers/phonepe/paymentGateway.js"
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
}>) => {
  const lockAttemptsForReconciliation = vi.fn()
    .mockResolvedValueOnce([input.attempt])
    .mockResolvedValueOnce([])
  const markReconciliationRequired = vi.fn().mockResolvedValue(input.attempt)
  const rescheduleAttemptReconciliation = vi.fn().mockResolvedValue(input.attempt)
  const paymentsRepository = {
    lockAttemptsForReconciliation,
    markReconciliationRequired,
    rescheduleAttemptReconciliation,
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
    },
  } as PaymentReconciliationDeps
  return {
    deps,
    lockAttemptsForReconciliation,
    markReconciliationRequired,
    rescheduleAttemptReconciliation,
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
})
