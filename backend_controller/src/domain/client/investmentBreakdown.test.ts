import { describe, expect, test } from "vitest"

import { annualisedReturnBasisPoints } from "../shared/xirr.js"
import {
  foldFundBreakdown,
  foldInvestmentBreakdown,
  proposeSplitByValue,
  toCategorise,
  type BreakdownInput,
  type FundBreakdownFact,
  type GrowthPartFact,
  type LedgerEntryFact,
  type ScheduleFact,
  type SplitFact,
} from "./investmentBreakdown.js"

const FUND = "fund-1"
const AS_OF = "2026-06-30"

let sequence = 0

const entry = (fields: Partial<LedgerEntryFact> & Pick<LedgerEntryFact, "id" | "entryType">): LedgerEntryFact => {
  sequence += 1
  return {
    fundId: FUND,
    principalDeltaPaise: 0n,
    valueDeltaPaise: 0n,
    effectiveDate: "2026-01-01",
    sequence,
    allocationId: null,
    reversesEntryId: null,
    reasonCode: "test",
    ...fields,
  }
}

const contribution = (id: string, paise: bigint, effectiveDate = "2026-01-01"): LedgerEntryFact =>
  entry({ id, entryType: "contribution", principalDeltaPaise: paise, valueDeltaPaise: paise, effectiveDate, allocationId: `alloc-${id}` })

const growth = (id: string, paise: bigint, effectiveDate = "2026-02-01"): LedgerEntryFact =>
  entry({ id, entryType: "growth_adjustment", valueDeltaPaise: paise, effectiveDate })

const reversal = (id: string, original: LedgerEntryFact): LedgerEntryFact =>
  entry({
    id,
    entryType: "reversal",
    principalDeltaPaise: -original.principalDeltaPaise,
    valueDeltaPaise: -original.valueDeltaPaise,
    effectiveDate: original.effectiveDate,
    reversesEntryId: original.id,
  })

const withdrawal = (id: string, valuePaise: bigint, principalPaise: bigint, effectiveDate = "2026-05-01"): LedgerEntryFact =>
  entry({ id, entryType: "withdrawal", valueDeltaPaise: -valuePaise, principalDeltaPaise: -principalPaise, effectiveDate })

const schedule = (id: string, state: ScheduleFact["state"], monthsPaid: number, monthCount = 12): ScheduleFact => ({
  id,
  fundId: FUND,
  state,
  monthCount,
  monthsPaid,
})

const oneTimePart = (entryId: string, recording: string, amountPaise: bigint): GrowthPartFact => ({
  entryId,
  target: { kind: "one_time", allocationId: `alloc-${recording}` },
  amountPaise,
})

const sipPart = (entryId: string, scheduleId: string, amountPaise: bigint): GrowthPartFact => ({
  entryId,
  target: { kind: "sip", scheduleId },
  amountPaise,
})

const inputOf = (fields: Partial<BreakdownInput> & Pick<BreakdownInput, "entries">): BreakdownInput => ({
  oneTimeCategories: new Set(),
  sipLinks: new Map(),
  schedules: [],
  growthParts: [],
  splits: new Map(),
  onlinePaymentEntryIds: new Set(),
  earlyExits: [],
  ...fields,
})

const oneTimeOf = (fund: FundBreakdownFact, recording: string) =>
  fund.oneTime.find((block) => block.allocationId === `alloc-${recording}`)

const blocksTotal = (fund: FundBreakdownFact): bigint =>
  [...fund.sips, ...fund.oneTime, ...fund.lines].reduce((sum, block) => sum + block.valuePaise, 0n)

const sipAndOneTime = () => {
  const p1 = contribution("p1", 100_000n, "2026-01-05")
  const a = contribution("a", 1_000_000n, "2026-01-10")
  const g1 = growth("g1", 6_000n)
  const g2 = growth("g2", 4_000n, "2026-03-01")
  return { p1, a, g1, g2, base: { sipLinks: new Map([["p1", "s1"]]), oneTimeCategories: new Set(["a"]), schedules: [schedule("s1", "active", 1)] } }
}

const splitOf = (cutoff: string, entryIds: readonly string[], totalPaise: bigint, parts: SplitFact["parts"]): Map<string, SplitFact> =>
  new Map([[FUND, { id: "split-1", fundId: FUND, cutoffEntryId: cutoff, totalPaise, parts, entryIds: new Set(entryIds), confirmedAt: new Date(0) }]])

describe("investment breakdown fold", () => {
  test("sumsToPositionValue: every ready fund adds up to the paisa, and a fund that does not is preparing", () => {
    const { p1, a, g1, base } = sipAndOneTime()
    const targeted = growth("t1", 1_001n)
    const ready = inputOf({
      ...base,
      entries: [p1, a, g1, targeted, withdrawal("w1", 333_333n, 300_000n)],
      growthParts: [sipPart("g1", "s1", 2_500n), oneTimePart("g1", "a", 3_500n), sipPart("t1", "s1", 1n), oneTimePart("t1", "a", 1_000n)],
    })
    const [fund] = foldInvestmentBreakdown(ready, AS_OF)
    expect(fund?.status).toBe("ready")
    expect(fund?.positionValuePaise).toBe(1_100_000n + 6_000n + 1_001n - 333_333n)
    expect(fund === undefined ? null : blocksTotal(fund)).toBe(fund?.positionValuePaise)

    const broken = inputOf({ ...base, entries: [p1, a, g1], growthParts: [sipPart("g1", "s1", 2_500n), oneTimePart("g1", "a", 3_000n)] })
    const brokenFund = foldFundBreakdown(broken, FUND, AS_OF)
    expect(brokenFund.status).toBe("preparing")
    expect(brokenFund.preparingReason).toBe("sum_mismatch")
  })

  test("singleInvestmentTakesAllUntargetedGrowth", () => {
    const a = contribution("a", 1_000_000n)
    const fund = foldFundBreakdown(
      inputOf({ entries: [a, growth("g1", 50_000n), growth("g2", 25_000n, "2026-03-01")], oneTimeCategories: new Set(["a"]) }),
      FUND,
      AS_OF,
    )
    expect(fund.status).toBe("ready")
    expect(oneTimeOf(fund, "a")).toEqual({
      entryId: "a",
      allocationId: "alloc-a",
      effectiveDate: "2026-01-01",
      investedPaise: 1_000_000n,
      valuePaise: 1_075_000n,
      growthPaise: 75_000n,
      simpleReturnBasisPoints: 750n,
      reversed: false,
    })
  })

  test("splitCoversUntargetedGrowthUpToCutoff, and growth after the cutoff makes the fund preparing", () => {
    const { p1, a, g1, g2, base } = sipAndOneTime()
    const splits = splitOf("g2", ["g1", "g2"], 10_000n, [
      { target: { kind: "one_time", allocationId: "alloc-a" }, amountPaise: 7_000n },
      { target: { kind: "sip", scheduleId: "s1" }, amountPaise: 3_000n },
    ])
    const covered = foldFundBreakdown(inputOf({ ...base, entries: [p1, a, g1, g2], splits }), FUND, AS_OF)
    expect(covered.status).toBe("ready")
    expect(oneTimeOf(covered, "a")?.growthPaise).toBe(7_000n)
    expect(covered.sips[0]?.growthPaise).toBe(3_000n)

    const later = inputOf({ ...base, entries: [p1, a, g1, g2, growth("g3", 1_000n, "2026-04-01")], splits })
    const uncovered = foldFundBreakdown(later, FUND, AS_OF)
    expect(uncovered.status).toBe("preparing")
    expect(uncovered.preparingReason).toBe("uncovered_growth")
    expect(uncovered.uncoveredEntryIds).toEqual(["g3"])
    expect(toCategorise(later)).toEqual({ recordings: [], fundsNeedingSplit: [FUND] })
  })

  test("reversalOfCoveredGrowthFollowsSplit", () => {
    const { p1, a, g1, g2, base } = sipAndOneTime()
    const splits = splitOf("g2", ["g1", "g2"], 10_000n, [
      { target: { kind: "one_time", allocationId: "alloc-a" }, amountPaise: 7_000n },
      { target: { kind: "sip", scheduleId: "s1" }, amountPaise: 3_000n },
    ])
    const fund = foldFundBreakdown(inputOf({ ...base, entries: [p1, a, g1, g2, reversal("r1", g1)], splits }), FUND, AS_OF)
    expect(fund.status).toBe("ready")
    expect(oneTimeOf(fund, "a")?.growthPaise).toBe(7_000n - 4_200n)
    expect(fund.sips[0]?.growthPaise).toBe(3_000n - 1_800n)
    expect(blocksTotal(fund)).toBe(1_100_000n + 4_000n)
  })

  test("growthBeforeSecondInvestmentBelongsToFirst, even when the second is dated earlier", () => {
    const a = contribution("a", 1_000_000n, "2026-01-01")
    const g1 = growth("g1", 20_000n, "2026-02-01")
    const b = contribution("b", 500_000n, "2025-12-01")
    const input = inputOf({ entries: [a, g1, b], oneTimeCategories: new Set(["a", "b"]) })
    const fund = foldFundBreakdown(input, FUND, AS_OF)
    expect(fund.status).toBe("ready")
    expect(oneTimeOf(fund, "a")?.growthPaise).toBe(20_000n)
    expect(oneTimeOf(fund, "b")?.growthPaise).toBe(0n)
    expect(toCategorise(input)).toEqual({ recordings: [], fundsNeedingSplit: [] })
  })

  test("reversedRecordingMovesGrowthToOtherAdjustments when it is reversed and re-recorded", () => {
    const a = contribution("a", 1_000_000n, "2026-01-01")
    const g1 = growth("g1", 30_000n)
    const ra = reversal("ra", a)
    const b = contribution("b", 1_200_000n, "2026-01-01")
    const fund = foldFundBreakdown(
      inputOf({
        entries: [a, g1, ra, b, growth("g2", 20_000n, "2026-03-01")],
        oneTimeCategories: new Set(["a", "b"]),
      }),
      FUND,
      AS_OF,
    )
    expect(fund.status).toBe("ready")
    expect(oneTimeOf(fund, "a")).toMatchObject({ reversed: true, investedPaise: 0n, valuePaise: 0n, growthPaise: 0n })
    expect(oneTimeOf(fund, "b")).toMatchObject({ reversed: false, investedPaise: 1_200_000n, valuePaise: 1_220_000n })
    expect(fund.lines).toEqual([{ kind: "other_adjustments", valuePaise: 30_000n }])
    expect(blocksTotal(fund)).toBe(fund.positionValuePaise)
  })

  test("endedAndActiveSipAreSeparateBlocks, each with its own XIRR and months paid", () => {
    const ended = [contribution("e1", 100_000n, "2025-01-01"), contribution("e2", 100_000n, "2025-02-01"), contribution("e3", 100_000n, "2025-03-01")]
    const active = [contribution("n1", 100_000n, "2025-09-01"), contribution("n2", 100_000n, "2025-10-01")]
    const fund = foldFundBreakdown(
      inputOf({
        entries: [...ended, ...active, growth("g1", 15_000n, "2026-01-01")],
        sipLinks: new Map([...ended.map((row) => [row.id, "old"] as const), ...active.map((row) => [row.id, "new"] as const)]),
        schedules: [schedule("old", "closed", 3), schedule("new", "active", 2)],
        growthParts: [sipPart("g1", "old", 10_000n), sipPart("g1", "new", 5_000n)],
      }),
      FUND,
      AS_OF,
    )
    expect(fund.sips.map((block) => [block.scheduleId, block.state, block.investedPaise, block.valuePaise, block.monthsPaid])).toEqual([
      ["new", "active", 200_000n, 205_000n, 2],
      ["old", "ended", 300_000n, 310_000n, 3],
    ])
    const flows = (dates: readonly string[], value: bigint) => [
      ...dates.map((date) => ({ date, amountPaise: -100_000n })),
      { date: AS_OF, amountPaise: value },
    ]
    expect(fund.sips[0]?.xirrBasisPoints).toBe(annualisedReturnBasisPoints(flows(["2025-09-01", "2025-10-01"], 205_000n)))
    expect(fund.sips[1]?.xirrBasisPoints).toBe(annualisedReturnBasisPoints(flows(["2025-01-01", "2025-02-01", "2025-03-01"], 310_000n)))
    expect(fund.sips[0]?.xirrBasisPoints).not.toBe(fund.sips[1]?.xirrBasisPoints)
  })

  test("oneTimeLinkedLaterMovesIntoSip with its parts", () => {
    const { p1, a, base } = sipAndOneTime()
    const entries = [p1, a, growth("t1", 2_000n)]
    const growthParts = [oneTimePart("t1", "a", 2_000n)]
    const before = foldFundBreakdown(inputOf({ ...base, entries, growthParts }), FUND, AS_OF)
    expect(oneTimeOf(before, "a")?.valuePaise).toBe(1_002_000n)

    const after = foldFundBreakdown(
      inputOf({ ...base, entries, growthParts, sipLinks: new Map([["p1", "s1"], ["a", "s1"]]) }),
      FUND,
      AS_OF,
    )
    expect(after.oneTime).toEqual([])
    expect(after.sips[0]).toMatchObject({ investedPaise: 1_100_000n, valuePaise: 1_102_000n })
  })

  test("maturityWithdrawalSpreadsByValue, and a reinvestment turns each gain into principal", () => {
    const a = contribution("a", 1_000_000n)
    const b = contribution("b", 1_000_000n)
    const base = { oneTimeCategories: new Set(["a", "b"]) }
    const parts = [oneTimePart("ga", "a", 500_000n), oneTimePart("gb", "b", -500_000n)]
    const spread = foldFundBreakdown(
      inputOf({ ...base, entries: [a, b, growth("ga", 500_000n), growth("gb", -500_000n), withdrawal("w", 800_000n, 800_000n)], growthParts: parts }),
      FUND,
      AS_OF,
    )
    expect(oneTimeOf(spread, "a")).toMatchObject({ investedPaise: 400_000n, valuePaise: 900_000n })
    expect(oneTimeOf(spread, "b")).toMatchObject({ investedPaise: 800_000n, valuePaise: 300_000n })

    const reinvested = foldFundBreakdown(
      inputOf({
        ...base,
        entries: [a, contribution("c", 500_000n), growth("ga", 200_000n), growth("gc", 50_000n), entry({ id: "m", entryType: "maturity_reinvestment", principalDeltaPaise: 250_000n })],
        oneTimeCategories: new Set(["a", "c"]),
        growthParts: [oneTimePart("ga", "a", 200_000n), oneTimePart("gc", "c", 50_000n)],
      }),
      FUND,
      AS_OF,
    )
    expect(oneTimeOf(reinvested, "a")).toMatchObject({ investedPaise: 1_200_000n, valuePaise: 1_200_000n })
    expect(oneTimeOf(reinvested, "c")).toMatchObject({ investedPaise: 550_000n, valuePaise: 550_000n })
  })

  test("earlyExitComesOutOfSipOnly", () => {
    const payments = [contribution("p1", 100_000n, "2025-07-01"), contribution("p2", 100_000n, "2025-08-01"), contribution("p3", 100_000n, "2025-09-01")]
    const a = contribution("a", 1_000_000n, "2025-07-15")
    const fund = foldFundBreakdown(
      inputOf({
        entries: [...payments, a, growth("g1", 130_000n, "2026-01-01"), withdrawal("x", 330_000n, 300_000n, "2026-02-01")],
        sipLinks: new Map(payments.map((row) => [row.id, "s1"] as const)),
        oneTimeCategories: new Set(["a"]),
        schedules: [schedule("s1", "closed", 3)],
        growthParts: [sipPart("g1", "s1", 30_000n), oneTimePart("g1", "a", 100_000n)],
        earlyExits: [{ scheduleId: "s1", ledgerEntryId: "x" }],
      }),
      FUND,
      AS_OF,
    )
    expect(fund.status).toBe("ready")
    expect(fund.sips[0]).toMatchObject({ state: "ended", investedPaise: 0n, valuePaise: 0n })
    expect(oneTimeOf(fund, "a")).toMatchObject({ investedPaise: 1_000_000n, valuePaise: 1_100_000n })
  })

  test("sipXirrMatchesKnownFlows, and is null under 30 days", () => {
    const months = Array.from({ length: 12 }, (_, index) => `2025-${String(index + 1).padStart(2, "0")}-01`)
    const payments = months.map((date, index) => contribution(`m${String(index)}`, 100_000n, date))
    const fund = foldFundBreakdown(
      inputOf({
        entries: [...payments, growth("g1", 60_000n, "2025-12-20")],
        sipLinks: new Map(payments.map((row) => [row.id, "s1"] as const)),
        schedules: [schedule("s1", "active", 12)],
      }),
      FUND,
      "2025-12-31",
    )
    const expected = annualisedReturnBasisPoints([
      ...months.map((date) => ({ date, amountPaise: -100_000n })),
      { date: "2025-12-31", amountPaise: 1_260_000n },
    ])
    expect(expected).not.toBeNull()
    expect(fund.sips[0]?.xirrBasisPoints).toBe(expected)
    expect(fund.sips[0]?.simpleReturnBasisPoints).toBe(500n)

    const fresh = contribution("f1", 100_000n, "2025-12-15")
    const young = foldFundBreakdown(
      inputOf({ entries: [fresh], sipLinks: new Map([["f1", "s1"]]), schedules: [schedule("s1", "active", 1)] }),
      FUND,
      "2025-12-31",
    )
    expect(young.sips[0]?.xirrBasisPoints).toBeNull()
  })

  test("onlineOneOffIsOneTimeWithoutCategory", () => {
    const online = contribution("o1", 250_000n)
    const input = inputOf({ entries: [online, growth("g1", 5_000n)], onlinePaymentEntryIds: new Set(["o1"]) })
    const fund = foldFundBreakdown(input, FUND, AS_OF)
    expect(fund.status).toBe("ready")
    expect(oneTimeOf(fund, "o1")).toMatchObject({ investedPaise: 250_000n, valuePaise: 255_000n })
    expect(toCategorise(input).recordings).toEqual([])
  })

  test("uncategorisedRecordingMakesFundPreparing, corrections included", () => {
    const a = contribution("a", 1_000_000n)
    const correction = entry({ ...contribution("c", 10_000n), reasonCode: "recorded_offline_correction" })
    const input = inputOf({ entries: [a, correction], oneTimeCategories: new Set(["a"]) })
    const fund = foldFundBreakdown(input, FUND, AS_OF)
    expect(fund.status).toBe("preparing")
    expect(fund.preparingReason).toBe("uncategorised")
    expect(toCategorise(input)).toEqual({ recordings: ["c"], fundsNeedingSplit: [] })
  })

  test("a SIP with zero paid months shows an empty block beside the fund's other investments", () => {
    const a = contribution("a", 500_000n)
    const fund = foldFundBreakdown(
      inputOf({ entries: [a, growth("g1", 5_000n)], oneTimeCategories: new Set(["a"]), schedules: [schedule("s1", "active", 0)] }),
      FUND,
      AS_OF,
    )
    expect(fund.status).toBe("ready")
    expect(fund.sips).toEqual([
      {
        scheduleId: "s1",
        state: "active",
        investedPaise: 0n,
        valuePaise: 0n,
        growthPaise: 0n,
        simpleReturnBasisPoints: null,
        xirrBasisPoints: null,
        monthsPaid: 0,
        monthsTotal: 12,
      },
    ])
    expect(oneTimeOf(fund, "a")?.valuePaise).toBe(505_000n)
  })

  test("an ended SIP's XIRR counts its payments out and its early-exit money back", () => {
    const payments = [contribution("p1", 100_000n, "2025-01-01"), contribution("p2", 100_000n, "2025-02-01"), contribution("p3", 100_000n, "2025-03-01")]
    const fund = foldFundBreakdown(
      inputOf({
        entries: [...payments, growth("g1", 24_000n, "2025-06-01"), withdrawal("x", 324_000n, 300_000n, "2025-07-01")],
        sipLinks: new Map(payments.map((row) => [row.id, "s1"] as const)),
        schedules: [schedule("s1", "closed", 3)],
        earlyExits: [{ scheduleId: "s1", ledgerEntryId: "x" }],
      }),
      FUND,
      AS_OF,
    )
    const expected = annualisedReturnBasisPoints([
      { date: "2025-01-01", amountPaise: -100_000n },
      { date: "2025-02-01", amountPaise: -100_000n },
      { date: "2025-03-01", amountPaise: -100_000n },
      { date: "2025-07-01", amountPaise: 324_000n },
    ])
    expect(expected).not.toBeNull()
    expect(fund.sips[0]).toMatchObject({ state: "ended", valuePaise: 0n, xirrBasisPoints: expected })
  })

  test("a fund holding only corrections is preparing until they are categorised", () => {
    const first = entry({ ...contribution("c1", 20_000n), reasonCode: "recorded_offline_correction" })
    const second = entry({ ...contribution("c2", 30_000n), reasonCode: "recorded_offline_correction" })
    const waiting = inputOf({ entries: [first, second] })
    expect(foldFundBreakdown(waiting, FUND, AS_OF)).toMatchObject({ status: "preparing", preparingReason: "uncategorised" })
    expect(toCategorise(waiting).recordings).toEqual(["c1", "c2"])

    const sorted = foldFundBreakdown(inputOf({ entries: [first, second], oneTimeCategories: new Set(["c1", "c2"]) }), FUND, AS_OF)
    expect(sorted.status).toBe("ready")
    expect(sorted.oneTime.map((block) => block.investedPaise)).toEqual([30_000n, 20_000n])
  })

  test("a reversal that does not undo its entry's principal leaves the invested sum unbalanced, so the fund is preparing", () => {
    const a = contribution("a", 1_000_000n)
    const corrupt = entry({ ...reversal("ra", a), principalDeltaPaise: -900_000n })
    const fund = foldFundBreakdown(inputOf({ entries: [a, contribution("b", 100_000n), corrupt], oneTimeCategories: new Set(["a", "b"]) }), FUND, AS_OF)
    expect(fund.positionValuePaise).toBe(100_000n)
    expect(fund.status).toBe("preparing")
    expect(fund.preparingReason).toBe("sum_mismatch")
  })

  test("growth with no investment held goes to other adjustments and needs no split", () => {
    const a = contribution("a", 1_000_000n)
    const ra = reversal("ra", a)
    const input = inputOf({ entries: [a, ra, growth("g1", 7_000n)], oneTimeCategories: new Set(["a"]) })
    const fund = foldFundBreakdown(input, FUND, AS_OF)
    expect(fund.status).toBe("ready")
    expect(fund.lines).toEqual([{ kind: "other_adjustments", valuePaise: 7_000n }])
    expect(toCategorise(input)).toEqual({ recordings: [], fundsNeedingSplit: [] })
  })

  test("a proposed split covers the multi-investment growth and sums to its total exactly", () => {
    const entries = [contribution("a", 100_000n), contribution("b", 100_000n), contribution("c", 100_000n), growth("g1", 100n), growth("g2", -1n)]
    const proposal = proposeSplitByValue(inputOf({ entries, oneTimeCategories: new Set(["a", "b", "c"]) }), FUND)
    expect(proposal?.cutoffEntryId).toBe("g2")
    expect(proposal?.totalPaise).toBe(99n)
    expect(proposal?.parts.reduce((sum, part) => sum + part.amountPaise, 0n)).toBe(99n)
    expect(proposal?.parts.map((part) => part.amountPaise)).toEqual([33n, 33n, 33n])
  })
})
