import { describe, expect, test, vi } from "vitest"

import type { Transaction } from "../../db/repositories.js"
import type { MaturityRow } from "../../repositories/maturityRepository.js"
import {
  markPositionMatured,
  reinvestMaturedPosition,
  withdrawMaturedPosition,
  updateWithdrawalPayout,
} from "./maturitySettlement.js"

const TX = {} as Transaction
const NOW = new Date("2026-09-09T10:00:00.000Z")
const INPUT = {
  userId: "user-1",
  fundId: "fund-1",
  maturityId: "maturity-1",
  effectiveDate: "2026-09-09",
  reasonCode: "maturity_settlement",
  note: null,
  actorUserId: "admin-1",
  requestId: "11111111-1111-4111-8111-111111111111",
}
const maturity = (overrides: Partial<MaturityRow> = {}): MaturityRow => ({
  id: "maturity-1",
  userId: "user-1",
  fundId: "fund-1",
  state: "pending",
  maturedOn: "2026-09-01",
  principalAtMaturityPaise: 100_000n,
  valueAtMaturityPaise: 120_000n,
  settlement: null,
  settlementEntryId: null,
  reasonCode: "maturity_settlement",
  version: "1",
  ...overrides,
})
const dependencies = (principalPaise = 100_000n, currentValuePaise = 120_000n) => ({
  clientGrowthRepository: {
    lockPosition: vi.fn().mockResolvedValue(undefined),
    findPositionBasis: vi.fn().mockResolvedValue({
      principalPaise: String(principalPaise),
      currentValuePaise: String(currentValuePaise),
      latestEntryId: "latest-entry",
    }),
  },
  maturityRepository: {
    getPositionEffectiveDate: vi.fn().mockResolvedValue("2026-09-01"),
    insertSettlementEntry: vi.fn().mockResolvedValue({ id: "entry-1" }),
    markMatured: vi.fn().mockResolvedValue({ id: "maturity-1" }),
    lockOpenMaturity: vi.fn().mockResolvedValue(null),
    lockMaturityById: vi.fn().mockResolvedValue(maturity()),
    settleMaturity: vi.fn().mockResolvedValue(undefined),
    insertWithdrawalPayout: vi.fn().mockResolvedValue({ id: "payout-1" }),
    markPayoutPaid: vi.fn().mockResolvedValue(true),
    markPayoutFailed: vi.fn().mockResolvedValue(true),
  },
  auditRepository: { append: vi.fn().mockResolvedValue(undefined) },
  notificationRepository: { create: vi.fn().mockResolvedValue(undefined) },
  clock: () => NOW,
})
type Dependencies = ReturnType<typeof dependencies>
const domainDeps = (deps: Dependencies): Parameters<typeof withdrawMaturedPosition>[1] =>
  deps as unknown as Parameters<typeof withdrawMaturedPosition>[1]

const expectNoSettlement = (deps: Dependencies): void => {
  expect(deps.maturityRepository.insertSettlementEntry).not.toHaveBeenCalled()
  expect(deps.maturityRepository.insertWithdrawalPayout).not.toHaveBeenCalled()
  expect(deps.maturityRepository.settleMaturity).not.toHaveBeenCalled()
}

describe("maturity settlement financial integrity", () => {
  test.each([
    [100_000n, 120_000n, 10_000n, 0n, 100_000n, 110_000n],
    [100_000n, 120_000n, 30_000n, -10_000n, 90_000n, 90_000n],
    [100_000n, 120_000n, 120_000n, -100_000n, 0n, 0n],
    [100_000n, 80_000n, 30_000n, -30_000n, 70_000n, 50_000n],
  ])("withdrawal P=%s V=%s W=%s consumes positive growth first", async (principal, value, amount, delta, afterPrincipal, afterValue) => {
    const deps = dependencies(principal, value)
    const result = await withdrawMaturedPosition(TX, domainDeps(deps), { ...INPUT, amountPaise: amount })
    expect(result).toMatchObject({
      entryId: "entry-1",
      payoutId: "payout-1",
      principalPaise: afterPrincipal,
      currentValuePaise: afterValue,
      principalDeltaPaise: delta,
      valueDeltaPaise: -amount,
    })
    expect(deps.maturityRepository.insertSettlementEntry).toHaveBeenCalledWith(TX, expect.objectContaining({
      entryType: "withdrawal", principalDeltaPaise: delta, valueDeltaPaise: -amount,
    }))
    expect(deps.maturityRepository.insertWithdrawalPayout).toHaveBeenCalledWith(TX, expect.objectContaining({
      ledgerEntryId: "entry-1", amountPaise: amount, principalPortionPaise: -delta,
      growthPortionPaise: amount + delta,
    }))
    expect(deps.clientGrowthRepository.lockPosition.mock.invocationCallOrder[0]).toBeLessThan(
      deps.clientGrowthRepository.findPositionBasis.mock.invocationCallOrder[0] ?? 0,
    )
  })

  test.each([0n, -1n, 120_001n])("rejects invalid withdrawal %s without writing money", async (amountPaise) => {
    const deps = dependencies()
    await expect(withdrawMaturedPosition(TX, domainDeps(deps), { ...INPUT, amountPaise })).rejects.toMatchObject({ code: "VALIDATION_FAILED" })
    expectNoSettlement(deps)
  })

  test.each([120_000n, 80_000n])("reinvestment realises value %s as principal without changing value", async (value) => {
    const deps = dependencies(100_000n, value)
    const result = await reinvestMaturedPosition(TX, domainDeps(deps), INPUT)
    expect(result).toMatchObject({
      principalPaise: value, currentValuePaise: value,
      principalDeltaPaise: value - 100_000n, valueDeltaPaise: 0n, payoutId: null,
    })
    expect(deps.maturityRepository.insertSettlementEntry).toHaveBeenCalledWith(TX, expect.objectContaining({
      entryType: "maturity_reinvestment", principalDeltaPaise: value - 100_000n, valueDeltaPaise: 0n,
    }))
    expect(deps.maturityRepository.insertWithdrawalPayout).not.toHaveBeenCalled()
  })

  test("refuses reinvestment with no gain or loss", async () => {
    const deps = dependencies(100_000n, 100_000n)
    await expect(reinvestMaturedPosition(TX, domainDeps(deps), INPUT)).rejects.toMatchObject({ code: "STATE_CONFLICT" })
    expectNoSettlement(deps)
  })

  test.each([
    null,
    maturity({ fundId: "other-fund" }),
    maturity({ userId: "other-user" }),
    maturity({ state: "settled", settlement: "withdrawal", settlementEntryId: "old-entry" }),
  ])("rejects missing, mismatched or already settled maturity", async (row) => {
    const deps = dependencies()
    deps.maturityRepository.lockMaturityById.mockResolvedValue(row)
    await expect(withdrawMaturedPosition(TX, domainDeps(deps), { ...INPUT, amountPaise: 1n })).rejects.toMatchObject({ code: row?.state === "settled" ? "STATE_CONFLICT" : "RESOURCE_NOT_FOUND" })
    expectNoSettlement(deps)
  })

  test.each(["2026-08-31", "2026-09-10"])("rejects settlement outside its valid date range: %s", async (effectiveDate) => {
    const deps = dependencies()
    await expect(withdrawMaturedPosition(TX, domainDeps(deps), { ...INPUT, effectiveDate, amountPaise: 1n })).rejects.toMatchObject({ code: effectiveDate > INPUT.effectiveDate ? "VALIDATION_FAILED" : "STATE_CONFLICT" })
    expectNoSettlement(deps)
  })

  test("refuses settlement before the latest effective ledger date", async () => {
    const deps = dependencies()
    deps.maturityRepository.getPositionEffectiveDate.mockResolvedValue("2026-09-09")
    await expect(reinvestMaturedPosition(TX, domainDeps(deps), { ...INPUT, effectiveDate: "2026-09-08" })).rejects.toMatchObject({ code: "STATE_CONFLICT" })
    expectNoSettlement(deps)
  })

  test("refuses a second open maturity without writing a new record", async () => {
    const deps = dependencies()
    deps.maturityRepository.lockOpenMaturity.mockResolvedValue(maturity())
    await expect(markPositionMatured(TX, domainDeps(deps), { ...INPUT, maturedOn: "2026-09-09" })).rejects.toMatchObject({ code: "STATE_CONFLICT" })
    expect(deps.maturityRepository.markMatured).not.toHaveBeenCalled()
  })
})


describe("maturity and payout state protection", () => {
  test("marking maturity snapshots principal and value before settlement", async () => {
    const deps = dependencies()
    const result = await markPositionMatured(TX, domainDeps(deps), { ...INPUT, maturedOn: INPUT.effectiveDate })
    expect(result).toEqual({ maturityId: "maturity-1" })
    expect(deps.maturityRepository.markMatured).toHaveBeenCalledWith(TX, expect.objectContaining({
      principalAtMaturityPaise: 100_000n, valueAtMaturityPaise: 120_000n,
    }))
    expect(deps.auditRepository.append).toHaveBeenCalledWith(TX, expect.objectContaining({ command: "client_position.matured" }))
    expectNoSettlement(deps)
  })

  test.each([[0n, 0n], [-1n, 1n], [1n, -1n], [9_223_372_036_854_775_808n, 1n], [1n, 9_223_372_036_854_775_808n]])(
    "rejects unrepresentable or empty balances P=%s V=%s", async (principal, value) => {
      const deps = dependencies(principal, value)
      await expect(reinvestMaturedPosition(TX, domainDeps(deps), INPUT)).rejects.toMatchObject({ code: "STATE_CONFLICT" })
      expectNoSettlement(deps)
    },
  )

  test.each(["2026-02-30", "invalid", "2026-9-09"])("rejects invalid calendar date %s", async (effectiveDate) => {
    const deps = dependencies()
    await expect(reinvestMaturedPosition(TX, domainDeps(deps), { ...INPUT, effectiveDate })).rejects.toMatchObject({ code: "VALIDATION_FAILED" })
    expectNoSettlement(deps)
  })

  const payoutInput = {
    userId: INPUT.userId, payoutId: "payout-1", expectedVersion: 0, state: "paid" as const,
    transferReference: "BANK-123", failureCode: null, actorUserId: INPUT.actorUserId, requestId: INPUT.requestId,
  }

  test.each(["paid", "failed"] as const)("records %s payout without changing portfolio money", async (state) => {
    const deps = dependencies()
    const input = { ...payoutInput, state, transferReference: state === "paid" ? " BANK-123 " : null,
      failureCode: state === "failed" ? "bank_rejected" : null }
    await updateWithdrawalPayout(TX, domainDeps(deps), input)
    const write = state === "paid" ? deps.maturityRepository.markPayoutPaid : deps.maturityRepository.markPayoutFailed
    expect(write).toHaveBeenCalledWith(TX, expect.objectContaining({
      userId: INPUT.userId, expectedVersion: 0, now: NOW,
      ...(state === "paid" ? { transferReference: "BANK-123" } : { failureCode: "bank_rejected" }),
    }))
    expect(deps.auditRepository.append).toHaveBeenCalledWith(TX, expect.objectContaining({
      command: `withdrawal_payout.${state}`, fromState: "pending", toState: state, entityVersion: 1,
    }))
    expect(deps.notificationRepository.create).toHaveBeenCalledOnce()
    expectNoSettlement(deps)
  })

  test.each([
    { expectedVersion: -1 }, { expectedVersion: 0.5 }, { transferReference: " " },
    { transferReference: "a".repeat(257) }, { failureCode: "bank_rejected" },
    { state: "failed" as const, transferReference: null, failureCode: "bad code" },
    { state: "failed" as const, transferReference: null, failureCode: null },
  ])("rejects malformed payout transition %j before repository access", async (change) => {
    const deps = dependencies()
    await expect(updateWithdrawalPayout(TX, domainDeps(deps), { ...payoutInput, ...change })).rejects.toMatchObject({ code: "VALIDATION_FAILED" })
    expect(deps.maturityRepository.markPayoutPaid).not.toHaveBeenCalled()
    expect(deps.maturityRepository.markPayoutFailed).not.toHaveBeenCalled()
    expect(deps.auditRepository.append).not.toHaveBeenCalled()
  })

  test("rejects a stale payout version without a misleading audit or notification", async () => {
    const deps = dependencies()
    deps.maturityRepository.markPayoutPaid.mockResolvedValue(false)
    await expect(updateWithdrawalPayout(TX, domainDeps(deps), payoutInput)).rejects.toMatchObject({ code: "STATE_CONFLICT" })
    expect(deps.auditRepository.append).not.toHaveBeenCalled()
    expect(deps.notificationRepository.create).not.toHaveBeenCalled()
    expectNoSettlement(deps)
  })
})
