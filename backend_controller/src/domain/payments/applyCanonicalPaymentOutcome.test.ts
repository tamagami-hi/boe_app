import { describe, expect, test, vi } from "vitest"

import type { Payment, PaymentAttempt, Transaction } from "../../db/repositories.js"
import type { PaymentsRepository } from "../../repositories/paymentsRepository.js"
import type { InvestmentSettlementRepository } from "../../repositories/investmentSettlementRepository.js"
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
  succeeded_at: null,
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
  const markPaymentSucceeded = vi.fn().mockResolvedValue({ ...payment, succeeded_at: NOW })
  const markOrderAcceptedOnSettlement = vi.fn().mockResolvedValue({
    id: ORDER_ID,
    user_id: USER_ID,
    fund_id: "00000000-0000-4000-8000-000000000006",
    state: "accepted",
    version: "1",
  })
  const insertSystemAllocation = vi.fn().mockResolvedValue({ id: "00000000-0000-4000-8000-000000000005" })
  const insertSystemContribution = vi.fn().mockResolvedValue(undefined)
  const hasCompletedInvestmentSettlement = vi.fn().mockResolvedValue(true)
  const recordSystemInvestmentSettlement = vi.fn().mockResolvedValue(undefined)
  const createPendingFundReceiptAcknowledgement = vi.fn().mockResolvedValue(undefined)
  const recordPaymentDetail = vi.fn().mockResolvedValue(undefined)
  const markReconciliationRequired = vi.fn().mockResolvedValue(undefined)
  const markAttemptFailed = vi.fn().mockResolvedValue({ ...attempt, state: "failed" })
  const markPaymentFailed = vi.fn().mockResolvedValue({ ...payment, state: "failed" })
  const markOrderPaymentFailed = vi.fn().mockResolvedValue({ id: ORDER_ID, state: "payment_failed" })
  const repository = {
    findAttemptByMerchantOrderId: vi.fn().mockResolvedValue(attempt),
    lockAttemptById: vi.fn().mockResolvedValue(attempt),
    lockPaymentById: vi.fn().mockResolvedValue(payment),
    lockOrderById: vi.fn().mockResolvedValue({
      id: ORDER_ID,
      user_id: USER_ID,
      fund_id: "00000000-0000-4000-8000-000000000006",
      amount_paise: "1000000",
      currency: "INR",
      state: "payment_pending",
    }),
    recordPaymentDetail,
    markReconciliationRequired,
    markAttemptSucceeded,
    markPaymentSucceeded,
    markOrderAcceptedOnSettlement,
    markAttemptFailed,
    markPaymentFailed,
    markOrderPaymentFailed,
  } as unknown as PaymentsRepository
  const settlementRepository = {
    insertSystemAllocation,
    insertSystemContribution,
    hasCompletedInvestmentSettlement,
    recordSystemInvestmentSettlement,
    createPendingFundReceiptAcknowledgement,
  } as unknown as InvestmentSettlementRepository
  return {
    repository,
    settlementRepository,
    markAttemptSucceeded,
    markPaymentSucceeded,
    markOrderAcceptedOnSettlement,
    insertSystemAllocation,
    insertSystemContribution,
    hasCompletedInvestmentSettlement,
    recordSystemInvestmentSettlement,
    createPendingFundReceiptAcknowledgement,
    recordPaymentDetail,
    markReconciliationRequired,
    markAttemptFailed,
    markPaymentFailed,
    markOrderPaymentFailed,
  }
}

const applyOutcome = (
  harness: ReturnType<typeof createSettlementHarness>,
  outcome: CanonicalPaymentOutcome,
): Promise<void> => applyCanonicalPaymentOutcome(
  {} as Transaction,
  harness.repository,
  outcome,
  NOW,
  harness.settlementRepository,
)

const expectNoSettlement = (harness: ReturnType<typeof createSettlementHarness>) => {
  expect(harness.markAttemptSucceeded).not.toHaveBeenCalled()
  expect(harness.markPaymentSucceeded).not.toHaveBeenCalled()
  expect(harness.markOrderAcceptedOnSettlement).not.toHaveBeenCalled()
  expect(harness.insertSystemAllocation).not.toHaveBeenCalled()
  expect(harness.insertSystemContribution).not.toHaveBeenCalled()
  expect(harness.recordSystemInvestmentSettlement).not.toHaveBeenCalled()
  expect(harness.createPendingFundReceiptAcknowledgement).not.toHaveBeenCalled()
}

describe("applyCanonicalPaymentOutcome", () => {
  test("does not settle a completed outcome whose amount differs from the stored payment", async () => {
    const harness = createSettlementHarness()
    const outcome = completedOutcome({
      amountPaise: "999999",
      details: [{ ...completedOutcome().details[0]!, amountPaise: "999999" }],
    })

    await applyOutcome(harness, outcome)

    expectNoSettlement(harness)
    expect(harness.markReconciliationRequired).toHaveBeenCalledOnce()
  })

  test("does not settle a completed outcome without completed transaction evidence", async () => {
    const harness = createSettlementHarness()
    const outcome = completedOutcome({ details: [] })

    await applyOutcome(harness, outcome)

    expectNoSettlement(harness)
    expect(harness.markReconciliationRequired).toHaveBeenCalledOnce()
  })

  test("does not settle when the provider order differs from the stored attempt", async () => {
    const harness = createSettlementHarness()
    const outcome = completedOutcome({ providerOrderId: "OMO_DIFFERENT_ORDER" })

    await applyOutcome(harness, outcome)

    expectNoSettlement(harness)
    expect(harness.markReconciliationRequired).toHaveBeenCalledOnce()
  })

  test("does not settle when provider merchant order or currency evidence differs", async () => {
    const merchantHarness = createSettlementHarness()
    await applyOutcome(merchantHarness, completedOutcome({ providerMerchantOrderId: "BOE_DIFFERENT_ORDER" }))
    expectNoSettlement(merchantHarness)
    expect(merchantHarness.markReconciliationRequired).toHaveBeenCalledOnce()

    const currencyHarness = createSettlementHarness()
    await applyOutcome(currencyHarness, completedOutcome({ currency: "USD" }))
    expectNoSettlement(currencyHarness)
    expect(currencyHarness.markReconciliationRequired).toHaveBeenCalledOnce()
  })

  test("settles exact completed evidence into an accepted investment and pending acknowledgement", async () => {
    const harness = createSettlementHarness()

    await applyOutcome(harness, completedOutcome())

    expect(harness.recordPaymentDetail).toHaveBeenCalledOnce()
    expect(harness.markAttemptSucceeded).toHaveBeenCalledOnce()
    expect(harness.markPaymentSucceeded).toHaveBeenCalledOnce()
    expect(harness.markOrderAcceptedOnSettlement).toHaveBeenCalledOnce()
    expect(harness.insertSystemAllocation).toHaveBeenCalledWith(expect.anything(), {
      orderId: ORDER_ID,
      userId: USER_ID,
      fundId: "00000000-0000-4000-8000-000000000006",
      amountPaise: "1000000",
      allocatedAt: NOW,
      requestId: `settlement:${PAYMENT_ID}`,
    })
    expect(harness.insertSystemContribution).toHaveBeenCalledOnce()
    expect(harness.recordSystemInvestmentSettlement).toHaveBeenCalledWith(expect.anything(), {
      orderId: ORDER_ID,
      paymentId: PAYMENT_ID,
      userId: USER_ID,
      fundId: "00000000-0000-4000-8000-000000000006",
      amountPaise: "1000000",
      requestId: PAYMENT_ID,
      entityVersion: 1,
    })
    expect(harness.createPendingFundReceiptAcknowledgement).toHaveBeenCalledOnce()
    expect(harness.markReconciliationRequired).not.toHaveBeenCalled()
  })

  test("accepts split provider transaction details only when their integer sum equals the payment", async () => {
    const harness = createSettlementHarness()
    const splitDetails = [
      { ...completedOutcome().details[0]!, transactionId: "T_PROVIDER_TRANSACTION_1", amountPaise: "400000" },
      { ...completedOutcome().details[0]!, transactionId: "T_PROVIDER_TRANSACTION_2", amountPaise: "600000" },
    ]

    await applyOutcome(harness, completedOutcome({ details: splitDetails }))

    expect(harness.recordPaymentDetail).toHaveBeenCalledTimes(2)
    expect(harness.insertSystemAllocation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      amountPaise: "1000000",
    }))
    expect(harness.insertSystemContribution).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      amountPaise: "1000000",
    }))
  })

  test("rejects split provider transaction details whose integer sum differs from the payment", async () => {
    const harness = createSettlementHarness()
    const splitDetails = [
      { ...completedOutcome().details[0]!, transactionId: "T_PROVIDER_TRANSACTION_1", amountPaise: "400000" },
      { ...completedOutcome().details[0]!, transactionId: "T_PROVIDER_TRANSACTION_2", amountPaise: "599999" },
    ]

    await applyOutcome(harness, completedOutcome({ details: splitDetails }))

    expectNoSettlement(harness)
    expect(harness.markReconciliationRequired).toHaveBeenCalledOnce()
  })

  test("ignores unknown merchant orders without touching payment or ledger state", async () => {
    const harness = createSettlementHarness()
    vi.mocked(harness.repository.findAttemptByMerchantOrderId).mockResolvedValue(null)

    await applyOutcome(harness, completedOutcome())

    expect(harness.repository.lockAttemptById).not.toHaveBeenCalled()
    expectNoSettlement(harness)
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

    await applyOutcome(harness, failed)

    expect(harness.markAttemptFailed).toHaveBeenCalledOnce()
    expect(harness.markPaymentFailed).toHaveBeenCalledOnce()
    expect(harness.markOrderPaymentFailed).toHaveBeenCalledOnce()
    expect(harness.createPendingFundReceiptAcknowledgement).not.toHaveBeenCalled()
  })

  test("quarantines contradictory failure evidence for a previously succeeded payment", async () => {
    const harness = createSettlementHarness()
    vi.mocked(harness.repository.lockPaymentById).mockResolvedValue({
      ...payment,
      succeeded_at: NOW,
    })

    await applyOutcome(harness, {
      ...completedOutcome(),
      outcome: "failed",
      providerState: "FAILED",
      amountPaise: null,
      details: [],
    })

    expect(harness.markReconciliationRequired).toHaveBeenCalledOnce()
    expect(harness.markAttemptFailed).not.toHaveBeenCalled()
    expect(harness.markPaymentFailed).not.toHaveBeenCalled()
    expect(harness.markOrderPaymentFailed).not.toHaveBeenCalled()
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

    await applyOutcome(harness, failed)

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

    await applyOutcome(harness, completedOutcome({ amountPaise: null }))

    expect(harness.markReconciliationRequired).not.toHaveBeenCalled()
    expectNoSettlement(harness)
  })

  test("rejects an idempotent success replay when the order did not advance", async () => {
    const harness = createSettlementHarness()
    vi.mocked(harness.repository.lockAttemptById).mockResolvedValue({ ...attempt, state: "succeeded" })
    vi.mocked(harness.repository.lockPaymentById).mockResolvedValue({ ...payment, state: "succeeded" })

    await expect(applyOutcome(harness, completedOutcome()))
      .rejects.toThrow("order success correlation failed")
  })

  test("accepts an idempotent success replay only when the complete financial shape exists", async () => {
    const harness = createSettlementHarness()
    vi.mocked(harness.repository.lockAttemptById).mockResolvedValue({ ...attempt, state: "succeeded" })
    vi.mocked(harness.repository.lockPaymentById).mockResolvedValue({ ...payment, state: "succeeded" })
    vi.mocked(harness.repository.lockOrderById).mockResolvedValue({
      id: ORDER_ID,
      user_id: USER_ID,
      fund_id: "00000000-0000-4000-8000-000000000006",
      amount_paise: "1000000",
      currency: "INR",
      state: "accepted",
    } as never)

    await applyOutcome(harness, completedOutcome())

    expect(harness.hasCompletedInvestmentSettlement).toHaveBeenCalledWith(expect.anything(), {
      orderId: ORDER_ID,
      paymentId: PAYMENT_ID,
    })
    expectNoSettlement(harness)
  })

  test("rejects an idempotent success replay when the financial shape is incomplete", async () => {
    const harness = createSettlementHarness()
    vi.mocked(harness.repository.lockAttemptById).mockResolvedValue({ ...attempt, state: "succeeded" })
    vi.mocked(harness.repository.lockPaymentById).mockResolvedValue({ ...payment, state: "succeeded" })
    vi.mocked(harness.repository.lockOrderById).mockResolvedValue({
      id: ORDER_ID,
      user_id: USER_ID,
      fund_id: "00000000-0000-4000-8000-000000000006",
      amount_paise: "1000000",
      currency: "INR",
      state: "accepted",
    } as never)
    harness.hasCompletedInvestmentSettlement.mockResolvedValue(false)

    await expect(applyOutcome(harness, completedOutcome()))
      .rejects.toThrow("order success correlation failed")

    expectNoSettlement(harness)
  })
})
