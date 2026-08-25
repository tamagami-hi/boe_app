import { describe, expect, test, vi } from "vitest"

import type { Payment, PaymentAttempt, Transaction } from "../../db/repositories.js"
import type { PaymentsRepository } from "../../repositories/paymentsRepository.js"
import {
  applyCanonicalPaymentOutcome,
  type CanonicalPaymentOutcome,
} from "./applyCanonicalPaymentOutcome.js"

const NOW = new Date("2026-08-25T00:00:00.000Z")
const PAYMENT_ID = "00000000-0000-4000-8000-000000000001"
const ATTEMPT_ID = "00000000-0000-4000-8000-000000000002"
const USER_ID = "00000000-0000-4000-8000-000000000003"
const ORDER_ID = "00000000-0000-4000-8000-000000000004"
const MERCHANT_ORDER_ID = "BOE_TEST_ORDER"
const PROVIDER_ORDER_ID = "OMO_PROVIDER_ORDER"

type CompletedOutcome = CanonicalPaymentOutcome & {
  readonly amountPaise: string | null
  readonly currency: string | null
}

const attempt = {
  id: ATTEMPT_ID,
  payment_id: PAYMENT_ID,
  user_id: USER_ID,
  merchant_order_id: MERCHANT_ORDER_ID,
  provider_order_id: PROVIDER_ORDER_ID,
  state: "provider_pending",
} as unknown as PaymentAttempt

const payment = {
  id: PAYMENT_ID,
  order_id: ORDER_ID,
  user_id: USER_ID,
  amount_paise: "1000000",
  currency: "INR",
  state: "provider_pending",
} as unknown as Payment

const completedOutcome = (overrides: Partial<CompletedOutcome> = {}): CompletedOutcome => ({
  merchantOrderId: MERCHANT_ORDER_ID,
  providerMerchantOrderId: MERCHANT_ORDER_ID,
  outcome: "succeeded",
  providerState: "COMPLETED",
  providerOrderId: PROVIDER_ORDER_ID,
  amountPaise: "1000000",
  currency: "INR",
  details: [
    {
      transactionId: "T_PROVIDER_TRANSACTION",
      reference: "UTR_REFERENCE",
      instrumentType: "UPI",
      state: "COMPLETED",
      amountPaise: "1000000",
    },
  ],
  ...overrides,
})

const createSettlementHarness = () => {
  const markAttemptSucceeded = vi.fn().mockResolvedValue(attempt)
  const markPaymentSucceeded = vi.fn().mockResolvedValue(payment)
  const markOrderReviewPending = vi.fn().mockResolvedValue({ id: ORDER_ID })
  const createPendingReview = vi.fn().mockResolvedValue(undefined)
  const recordPaymentDetail = vi.fn().mockResolvedValue(undefined)
  const markReconciliationRequired = vi.fn().mockResolvedValue(undefined)
  const markAttemptFailed = vi.fn().mockResolvedValue({ ...attempt, state: "failed" })
  const markPaymentFailed = vi.fn().mockResolvedValue({ ...payment, state: "failed" })
  const markOrderPaymentFailed = vi.fn().mockResolvedValue({ id: ORDER_ID, state: "payment_failed" })
  const repository = {
    findAttemptByMerchantOrderId: vi.fn().mockResolvedValue(attempt),
    lockAttemptById: vi.fn().mockResolvedValue(attempt),
    lockPaymentById: vi.fn().mockResolvedValue(payment),
    lockOrderById: vi.fn().mockResolvedValue({ id: ORDER_ID, user_id: USER_ID, amount_paise: "1000000", currency: "INR", state: "payment_pending" }),
    recordPaymentDetail,
    markReconciliationRequired,
    markAttemptSucceeded,
    markPaymentSucceeded,
    markOrderReviewPending,
    createPendingReview,
    markAttemptFailed,
    markPaymentFailed,
    markOrderPaymentFailed,
  } as unknown as PaymentsRepository
  return {
    repository,
    markAttemptSucceeded,
    markPaymentSucceeded,
    markOrderReviewPending,
    createPendingReview,
    recordPaymentDetail,
    markReconciliationRequired,
    markAttemptFailed,
    markPaymentFailed,
    markOrderPaymentFailed,
  }
}

const expectNoSettlement = (harness: ReturnType<typeof createSettlementHarness>) => {
  expect(harness.markAttemptSucceeded).not.toHaveBeenCalled()
  expect(harness.markPaymentSucceeded).not.toHaveBeenCalled()
  expect(harness.markOrderReviewPending).not.toHaveBeenCalled()
  expect(harness.createPendingReview).not.toHaveBeenCalled()
}

describe("applyCanonicalPaymentOutcome", () => {
  test("does not settle a completed outcome whose amount differs from the stored payment", async () => {
    const harness = createSettlementHarness()
    const outcome = completedOutcome({
      amountPaise: "999999",
      details: [{ ...completedOutcome().details[0]!, amountPaise: "999999" }],
    })

    await applyCanonicalPaymentOutcome(
      {} as Transaction,
      harness.repository,
      outcome,
      NOW,
    )

    expectNoSettlement(harness)
    expect(harness.markReconciliationRequired).toHaveBeenCalledOnce()
  })

  test("does not settle a completed outcome without completed transaction evidence", async () => {
    const harness = createSettlementHarness()
    const outcome = completedOutcome({ details: [] })

    await applyCanonicalPaymentOutcome(
      {} as Transaction,
      harness.repository,
      outcome,
      NOW,
    )

    expectNoSettlement(harness)
    expect(harness.markReconciliationRequired).toHaveBeenCalledOnce()
  })

  test("does not settle when the provider order differs from the stored attempt", async () => {
    const harness = createSettlementHarness()
    const outcome = completedOutcome({ providerOrderId: "OMO_DIFFERENT_ORDER" })

    await applyCanonicalPaymentOutcome(
      {} as Transaction,
      harness.repository,
      outcome,
      NOW,
    )

    expectNoSettlement(harness)
    expect(harness.markReconciliationRequired).toHaveBeenCalledOnce()
  })

  test("does not settle when provider merchant order or currency evidence differs", async () => {
    const merchantHarness = createSettlementHarness()
    await applyCanonicalPaymentOutcome(
      {} as Transaction,
      merchantHarness.repository,
      completedOutcome({ providerMerchantOrderId: "BOE_DIFFERENT_ORDER" }),
      NOW,
    )
    expectNoSettlement(merchantHarness)
    expect(merchantHarness.markReconciliationRequired).toHaveBeenCalledOnce()

    const currencyHarness = createSettlementHarness()
    await applyCanonicalPaymentOutcome(
      {} as Transaction,
      currencyHarness.repository,
      completedOutcome({ currency: "USD" }),
      NOW,
    )
    expectNoSettlement(currencyHarness)
    expect(currencyHarness.markReconciliationRequired).toHaveBeenCalledOnce()
  })

  test("settles exact completed evidence and creates one review", async () => {
    const harness = createSettlementHarness()

    await applyCanonicalPaymentOutcome({} as Transaction, harness.repository, completedOutcome(), NOW)

    expect(harness.recordPaymentDetail).toHaveBeenCalledOnce()
    expect(harness.markAttemptSucceeded).toHaveBeenCalledOnce()
    expect(harness.markPaymentSucceeded).toHaveBeenCalledOnce()
    expect(harness.markOrderReviewPending).toHaveBeenCalledOnce()
    expect(harness.createPendingReview).toHaveBeenCalledOnce()
    expect(harness.markReconciliationRequired).not.toHaveBeenCalled()
  })

  test("records a provider failure without creating a review", async () => {
    const harness = createSettlementHarness()
    const failed = {
      ...completedOutcome(),
      outcome: "failed" as const,
      providerState: "FAILED",
      amountPaise: null,
      details: [],
    }

    await applyCanonicalPaymentOutcome({} as Transaction, harness.repository, failed, NOW)

    expect(harness.markAttemptFailed).toHaveBeenCalledOnce()
    expect(harness.markPaymentFailed).toHaveBeenCalledOnce()
    expect(harness.markOrderPaymentFailed).toHaveBeenCalledOnce()
    expect(harness.createPendingReview).not.toHaveBeenCalled()
  })

  test("quarantines a failed fact correlated to a different merchant order", async () => {
    const harness = createSettlementHarness()
    const failed = {
      ...completedOutcome(),
      providerMerchantOrderId: "BOE_DIFFERENT_ORDER",
      outcome: "failed" as const,
      providerState: "FAILED",
      details: [],
    }

    await applyCanonicalPaymentOutcome({} as Transaction, harness.repository, failed, NOW)

    expect(harness.markReconciliationRequired).toHaveBeenCalledOnce()
    expect(harness.markAttemptFailed).not.toHaveBeenCalled()
    expect(harness.markPaymentFailed).not.toHaveBeenCalled()
  })

  test("treats an already quarantined outcome as an idempotent replay", async () => {
    const harness = createSettlementHarness()
    vi.mocked(harness.repository.lockAttemptById).mockResolvedValue({
      ...attempt,
      state: "reconciliation_required",
    })
    vi.mocked(harness.repository.lockPaymentById).mockResolvedValue({
      ...payment,
      state: "reconciliation_required",
    })

    await applyCanonicalPaymentOutcome({} as Transaction, harness.repository, completedOutcome({ amountPaise: null }), NOW)

    expect(harness.markReconciliationRequired).not.toHaveBeenCalled()
    expectNoSettlement(harness)
  })

  test("rejects an idempotent success replay when the order did not advance", async () => {
    const harness = createSettlementHarness()
    vi.mocked(harness.repository.lockAttemptById).mockResolvedValue({ ...attempt, state: "succeeded" })
    vi.mocked(harness.repository.lockPaymentById).mockResolvedValue({ ...payment, state: "succeeded" })

    await expect(applyCanonicalPaymentOutcome({} as Transaction, harness.repository, completedOutcome(), NOW))
      .rejects.toThrow("order success correlation failed")
  })
})
