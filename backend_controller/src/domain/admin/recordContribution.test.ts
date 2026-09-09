import { describe, expect, test, vi } from "vitest"

import type { Transaction } from "../../db/repositories.js"
import type { LedgerEntryRow } from "../../repositories/clientPositionRepository.js"
import { recordContribution, type RecordContributionDeps } from "./recordContribution.js"
import { reverseLedgerEntry, type ReverseLedgerEntryDeps } from "./reverseLedgerEntry.js"

const NOW = new Date("2026-09-09T10:00:00.000Z")
const TX = {} as Transaction
const HISTORICAL_DATE = "2024-03-15"

const positionDeps = () =>
  ({
    clientPositionRepository: {
      findFundVersionForDate: vi
        .fn()
        .mockResolvedValue({ fundVersionId: "version-2024", historical: true }),
      insertRecordedOrder: vi.fn().mockResolvedValue({ id: "order-1" }),
      insertRecordedPayment: vi.fn().mockResolvedValue({ id: "payment-1" }),
      insertRecordedAllocation: vi.fn().mockResolvedValue({ id: "allocation-1" }),
      insertContributionEntry: vi.fn().mockResolvedValue({ id: "entry-1" }),
      insertReversalEntry: vi.fn().mockResolvedValue({ id: "reversal-1" }),
      findEntryIdentity: vi.fn().mockResolvedValue({ fundId: "fund-1" }),
      findReversalBasis: vi.fn().mockResolvedValue({
        principalPaise: 500_000n,
        currentValuePaise: 500_000n,
        contributionCount: 1n,
        minimumPrincipalPaise: 500_000n,
        minimumValuePaise: 500_000n,
      }),
      lockEntryForReversal: vi.fn(),
      listLedgerEntries: vi.fn(),
    },
    clientGrowthRepository: {
      lockPosition: vi.fn().mockResolvedValue(undefined),
      findPositionBasis: vi
        .fn()
        .mockResolvedValue({ principalPaise: "500000", currentValuePaise: "500000", latestEntryId: "entry-1" }),
    },
    userRepository: { lockById: vi.fn().mockResolvedValue({ id: "user-1", version: "1" }) },
    auditRepository: { append: vi.fn().mockResolvedValue(undefined) },
    notificationRepository: { create: vi.fn().mockResolvedValue(undefined) },
    clock: () => NOW,
  }) as unknown as RecordContributionDeps & ReverseLedgerEntryDeps

const input = {
  userId: "user-1",
  fundId: "fund-1",
  amountPaise: 500_000n,
  effectiveDate: HISTORICAL_DATE,
  reasonCode: "recorded_offline_investment",
  note: null,
  actorUserId: "admin-1",
  requestId: "11111111-1111-4111-8111-111111111111",
}

const entry = (overrides: Partial<LedgerEntryRow> = {}): LedgerEntryRow => ({
  id: "entry-1",
  userId: "user-1",
  fundId: "fund-1",
  entryType: "contribution",
  principalDeltaPaise: 500_000n,
  valueDeltaPaise: 500_000n,
  effectiveDate: HISTORICAL_DATE,
  reasonCode: "recorded_offline_investment",
  reversesEntryId: null,
  reversedByEntryId: null,
  orderType: "recorded_offline",
  createdAt: NOW,
  ...overrides,
})

describe("recorded offline contributions", () => {
  test("moves principal and value by the same amount, as the contribution CHECK requires", async () => {
    const deps = positionDeps()

    await recordContribution(TX, deps, input)

    const written = vi.mocked(deps.clientPositionRepository.insertContributionEntry).mock.calls[0]?.[1]
    expect(written?.amountPaise).toBe(500_000n)
    expect(written?.orderId).toBe("order-1")
    expect(written?.paymentId).toBe("payment-1")
    expect(written?.allocationId).toBe("allocation-1")
  })

  test("dates the whole chain by the historical investment date, never today", async () => {
    const deps = positionDeps()

    await recordContribution(TX, deps, input)

    const order = vi.mocked(deps.clientPositionRepository.insertRecordedOrder).mock.calls[0]?.[1]
    const payment = vi.mocked(deps.clientPositionRepository.insertRecordedPayment).mock.calls[0]?.[1]
    const written = vi.mocked(deps.clientPositionRepository.insertContributionEntry).mock.calls[0]?.[1]

    expect(written?.effectiveDate).toBe(HISTORICAL_DATE)
    expect(order?.occurredAt.toISOString().slice(0, 10)).toBe(HISTORICAL_DATE)
    expect(payment?.occurredAt.toISOString().slice(0, 10)).toBe(HISTORICAL_DATE)
    expect(order?.occurredAt.getTime()).toBeLessThan(NOW.getTime())
  })

  test("locks the position before writing money", async () => {
    const deps = positionDeps()

    await recordContribution(TX, deps, input)

    expect(deps.clientGrowthRepository.lockPosition).toHaveBeenCalledWith(TX, "user-1", "fund-1")
    expect(
      vi.mocked(deps.clientGrowthRepository.lockPosition).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(deps.clientPositionRepository.insertRecordedOrder).mock.invocationCallOrder[0] ?? 0,
    )
  })

  test("writes nothing when the fund has no resolvable version", async () => {
    const deps = positionDeps()
    vi.mocked(deps.clientPositionRepository.findFundVersionForDate).mockResolvedValue(null)

    await expect(recordContribution(TX, deps, input)).rejects.toThrow()
    expect(deps.clientPositionRepository.insertRecordedOrder).not.toHaveBeenCalled()
    expect(deps.clientPositionRepository.insertContributionEntry).not.toHaveBeenCalled()
  })
})

describe("ledger reversal", () => {
  const reversalInput = {
    userId: "user-1",
    entryId: "entry-1",
    reasonCode: "admin_correction_reversal",
    note: null,
    actorUserId: "admin-1",
    requestId: "22222222-2222-4222-8222-222222222222",
  }

  test("negates both deltas exactly and keeps the original effective date", async () => {
    const deps = positionDeps()
    vi.mocked(deps.clientPositionRepository.lockEntryForReversal).mockResolvedValue(
      entry({ principalDeltaPaise: 500_000n, valueDeltaPaise: 500_000n }),
    )

    const reversed = await reverseLedgerEntry(TX, deps, reversalInput)

    expect(reversed.principalDeltaPaise).toBe(-500_000n)
    expect(reversed.valueDeltaPaise).toBe(-500_000n)
    expect(reversed.effectiveDate).toBe(HISTORICAL_DATE)
  })

  test("negates a growth adjustment without touching principal", async () => {
    const deps = positionDeps()
    vi.mocked(deps.clientPositionRepository.lockEntryForReversal).mockResolvedValue(
      entry({
        entryType: "growth_adjustment",
        principalDeltaPaise: 0n,
        valueDeltaPaise: 25_000n,
        orderType: null,
      }),
    )

    const reversed = await reverseLedgerEntry(TX, deps, reversalInput)

    expect(reversed.principalDeltaPaise).toBe(0n)
    expect(reversed.valueDeltaPaise).toBe(-25_000n)
  })

  test("refuses to reverse an entry that is already reversed", async () => {
    const deps = positionDeps()
    vi.mocked(deps.clientPositionRepository.lockEntryForReversal).mockResolvedValue(
      entry({ reversedByEntryId: "reversal-0" }),
    )

    await expect(reverseLedgerEntry(TX, deps, reversalInput)).rejects.toThrow()
    expect(deps.clientPositionRepository.insertReversalEntry).not.toHaveBeenCalled()
  })

  test("refuses to reverse a reversal", async () => {
    const deps = positionDeps()
    vi.mocked(deps.clientPositionRepository.lockEntryForReversal).mockResolvedValue(
      entry({ entryType: "reversal", reversesEntryId: "entry-0", orderType: null }),
    )

    await expect(reverseLedgerEntry(TX, deps, reversalInput)).rejects.toThrow()
    expect(deps.clientPositionRepository.insertReversalEntry).not.toHaveBeenCalled()
  })

  test("locks the position before appending the reversal", async () => {
    const deps = positionDeps()
    vi.mocked(deps.clientPositionRepository.lockEntryForReversal).mockResolvedValue(entry())

    await reverseLedgerEntry(TX, deps, reversalInput)

    expect(
      vi.mocked(deps.clientGrowthRepository.lockPosition).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(deps.userRepository.lockById).mock.invocationCallOrder[0] ?? 0,
    )
    expect(vi.mocked(deps.userRepository.lockById).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.clientPositionRepository.lockEntryForReversal).mock.invocationCallOrder[0] ?? 0,
    )
  })

  test.each([
    { principalPaise: 100_000n, currentValuePaise: 100_000n, contributionCount: 1n },
    { principalPaise: 500_000n, currentValuePaise: 400_000n, contributionCount: 1n },
    { principalPaise: 500_000n, currentValuePaise: 525_000n, contributionCount: 1n },
  ])("rejects a reversal leaving negative balances or an orphan residual: %o", async (basis) => {
    const deps = positionDeps()
    vi.mocked(deps.clientPositionRepository.lockEntryForReversal).mockResolvedValue(entry())
    vi.mocked(deps.clientPositionRepository.findReversalBasis).mockResolvedValue({
      ...basis,
      minimumPrincipalPaise: basis.principalPaise,
      minimumValuePaise: basis.currentValuePaise,
    })

    await expect(reverseLedgerEntry(TX, deps, reversalInput)).rejects.toThrow()

    expect(deps.clientPositionRepository.insertReversalEntry).not.toHaveBeenCalled()
    expect(deps.auditRepository.append).not.toHaveBeenCalled()
  })

  test("returns zero totals when reversing the only contribution", async () => {
    const deps = positionDeps()
    vi.mocked(deps.clientPositionRepository.lockEntryForReversal).mockResolvedValue(entry())

    const reversed = await reverseLedgerEntry(TX, deps, reversalInput)

    expect(reversed.principalPaise).toBe(0n)
    expect(reversed.currentValuePaise).toBe(0n)
  })

  test.each([
    { minimumPrincipalPaise: 200_000n, minimumValuePaise: 600_000n },
    { minimumPrincipalPaise: 600_000n, minimumValuePaise: 200_000n },
  ])("rejects a reversal making an earlier daily balance negative: %o", async (minimums) => {
    const deps = positionDeps()
    vi.mocked(deps.clientPositionRepository.lockEntryForReversal).mockResolvedValue(entry())
    vi.mocked(deps.clientPositionRepository.findReversalBasis).mockResolvedValue({
      principalPaise: 600_000n,
      currentValuePaise: 600_000n,
      contributionCount: 2n,
      ...minimums,
    })

    await expect(reverseLedgerEntry(TX, deps, reversalInput)).rejects.toThrow()

    expect(deps.clientPositionRepository.insertReversalEntry).not.toHaveBeenCalled()
    expect(deps.auditRepository.append).not.toHaveBeenCalled()
  })
})
