import { describe, expect, test } from "vitest"

import { AppError } from "../../http/errorCatalog.js"
import type { BreakdownInput, InvestmentRef, LedgerEntryFact } from "../client/investmentBreakdownFacts.js"
import {
  computeInvestmentGrowthBasisHash,
  planInvestmentGrowth,
  type InvestmentBasis,
  type InvestmentGrowthBases,
  type PositionGrowthBasis,
} from "./investmentGrowth.js"
import { clientFundGrowthBases } from "./investmentGrowthBases.js"

const FUND = "fund-1"
const ALICE = "user-a"
const BOB = "user-b"

const sip = (scheduleId: string): InvestmentRef => ({ kind: "sip", scheduleId })
const oneTime = (allocationId: string): InvestmentRef => ({ kind: "one_time", allocationId })

const investment = (
  userId: string,
  ref: InvestmentRef,
  investedPaise: bigint,
  valuePaise: bigint,
  holdsNothing = false,
): InvestmentBasis => ({ userId, fundId: FUND, ref, investedPaise, valuePaise, holdsNothing })

const position = (userId: string, valuePaise: bigint, categoriseFirst = false): PositionGrowthBasis => ({
  userId,
  fundId: FUND,
  valuePaise,
  latestEntryId: `latest-${userId}`,
  categoriseFirst,
})

const bases = (positions: readonly PositionGrowthBasis[], investments: readonly InvestmentBasis[]): InvestmentGrowthBases => ({
  positions,
  investments,
})

const fact = (id: string, fields: Partial<LedgerEntryFact> & Pick<LedgerEntryFact, "entryType" | "sequence">): LedgerEntryFact => ({
  id,
  fundId: FUND,
  principalDeltaPaise: 0n,
  valueDeltaPaise: 0n,
  effectiveDate: "2026-01-05",
  allocationId: null,
  reversesEntryId: null,
  reasonCode: "test",
  ...fields,
})

const paid = (id: string, paise: bigint, sequence: number): LedgerEntryFact =>
  fact(id, { entryType: "contribution", principalDeltaPaise: paise, valueDeltaPaise: paise, sequence, allocationId: `alloc-${id}` })

const closedSipInput = (exited: boolean): BreakdownInput => ({
  entries: [
    paid("p1", 100_000n, 1),
    paid("p2", 100_000n, 2),
    paid("a", 1_000_000n, 3),
    ...(exited ? [fact("x", { entryType: "withdrawal", principalDeltaPaise: -200_000n, valueDeltaPaise: -200_000n, sequence: 4 })] : []),
  ],
  oneTimeCategories: new Set(["a"]),
  sipLinks: new Map([
    ["p1", "s1"],
    ["p2", "s1"],
  ]),
  schedules: [{ id: "s1", fundId: FUND, state: "closed", monthCount: 12, monthsPaid: 2 }],
  growthParts: [],
  splits: new Map(),
  onlinePaymentEntryIds: new Set(),
  earlyExits: exited ? [{ scheduleId: "s1", ledgerEntryId: "x" }] : [],
})

const expectAppError = (run: () => unknown, code: string): AppError => {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
    return error as AppError
  }
  throw new Error("expected an AppError")
}

const ALICE_BASES = bases(
  [position(ALICE, 1_250_400n)],
  [
    investment(ALICE, sip("s-active"), 1_000_000n, 1_100_000n),
    investment(ALICE, oneTime("a-333"), 333n, 400n),
    investment(ALICE, oneTime("a-67"), 67n, 67n),
    investment(ALICE, oneTime("a-66"), 66n, 66n),
  ],
)

describe("planInvestmentGrowth", () => {
  test("a fund rate gives one entry per client whose delta is exactly the sum of its rounded parts", () => {
    const plan = planInvestmentGrowth(ALICE_BASES, { kind: "percentage", growthBasisPoints: 150n, target: null })

    expect(plan.entries).toHaveLength(1)
    const [entry] = plan.entries
    expect(entry?.parts.map((part) => [part.ref, part.deltaPaise])).toEqual([
      [oneTime("a-333"), 5n],
      [oneTime("a-66"), 1n],
      [oneTime("a-67"), 1n],
      [sip("s-active"), 15_000n],
    ])
    expect(entry?.deltaPaise).toBe(15_007n)
    expect(entry?.beforePaise).toBe(1_250_400n)
    expect(entry?.afterPaise).toBe(1_265_407n)
    expect(plan.totalDeltaPaise).toBe(15_007n)
  })

  test("a negative rate rounds each part away from zero and the entry still equals the parts, down to one paisa", () => {
    const plan = planInvestmentGrowth(ALICE_BASES, { kind: "percentage", growthBasisPoints: -75n, target: null })

    const [entry] = plan.entries
    expect(entry?.parts.map((part) => [part.ref, part.deltaPaise])).toEqual([
      [oneTime("a-333"), -2n],
      [oneTime("a-67"), -1n],
      [sip("s-active"), -7_500n],
    ])
    expect(entry?.deltaPaise).toBe(-7_503n)
    expect(entry?.deltaPaise).toBe(entry?.parts.reduce((sum, part) => sum + part.deltaPaise, 0n))
    expect(plan.skipped).toEqual([{ userId: ALICE, ref: oneTime("a-66"), reason: "unchanged" }])
  })

  test("a rate skips a zero-invested investment with no part and no error, and the client's other investments still get theirs", () => {
    const plan = planInvestmentGrowth(
      bases(
        [position(ALICE, 600_000n), position(BOB, 0n)],
        [
          investment(ALICE, sip("s-exited"), 0n, 0n),
          investment(ALICE, oneTime("a-1"), 500_000n, 600_000n),
          investment(BOB, oneTime("b-reversed"), 0n, 0n),
        ],
      ),
      { kind: "percentage", growthBasisPoints: 100n, target: null },
    )

    expect(plan.entries).toEqual([
      {
        userId: ALICE,
        fundId: FUND,
        beforePaise: 600_000n,
        deltaPaise: 5_000n,
        afterPaise: 605_000n,
        parts: [{ ref: oneTime("a-1"), investedPaise: 500_000n, beforePaise: 600_000n, deltaPaise: 5_000n, afterPaise: 605_000n }],
      },
    ])
    expect(plan.skipped).toEqual([
      { userId: ALICE, ref: sip("s-exited"), reason: "zero_invested" },
      { userId: BOB, ref: oneTime("b-reversed"), reason: "zero_invested" },
    ])
  })

  test("a closed SIP that still holds money takes a fund rate, a typed gain and growth for one investor", () => {
    const fold = clientFundGrowthBases(ALICE, FUND, closedSipInput(false))
    if (fold === null) throw new Error("expected bases")
    const closed = bases([fold.position], fold.investments)

    const rate = planInvestmentGrowth(closed, { kind: "percentage", growthBasisPoints: 100n, target: null })
    expect(rate.entries[0]?.parts.map((part) => [part.ref, part.deltaPaise])).toEqual([
      [oneTime("alloc-a"), 10_000n],
      [sip("s1"), 2_000n],
    ])
    const typed = planInvestmentGrowth(closed, {
      kind: "gain_since_invested",
      items: [{ userId: ALICE, ref: sip("s1"), gainSinceInvestedPaise: 500n }],
    })
    expect(typed.entries[0]?.parts.map((part) => [part.ref, part.deltaPaise])).toEqual([[sip("s1"), 500n]])
    const one = planInvestmentGrowth(closed, { kind: "amount", growthPaise: 300n, target: { userId: ALICE, ref: sip("s1") } })
    expect(one.entries[0]?.deltaPaise).toBe(300n)
  })

  test("an exited SIP gets nothing: no basis, no part from a rate, and naming it is refused", () => {
    const fold = clientFundGrowthBases(ALICE, FUND, closedSipInput(true))
    if (fold === null) throw new Error("expected bases")
    const exited = bases([fold.position], fold.investments)

    expect(fold.investments.map((row) => row.ref)).toEqual([oneTime("alloc-a")])
    const rate = planInvestmentGrowth(exited, { kind: "percentage", growthBasisPoints: 100n, target: null })
    expect(rate.entries[0]?.parts.map((part) => part.ref)).toEqual([oneTime("alloc-a")])
    expectAppError(
      () => planInvestmentGrowth(exited, { kind: "amount", growthPaise: 300n, target: { userId: ALICE, ref: sip("s1") } }),
      "VALIDATION_FAILED",
    )
    const empty = bases([position(ALICE, 0n)], [investment(ALICE, sip("s0"), 0n, 0n, true)])
    expectAppError(
      () => planInvestmentGrowth(empty, { kind: "amount", growthPaise: 300n, target: { userId: ALICE, ref: sip("s0") } }),
      "VALIDATION_FAILED",
    )
    expect(planInvestmentGrowth(empty, { kind: "percentage", growthBasisPoints: 100n, target: null }).skipped).toEqual([
      { userId: ALICE, ref: sip("s0"), reason: "zero_invested" },
    ])
  })

  test("typed changes that net to zero for one client skip that client as unchanged and keep the rest of the batch", () => {
    const plan = planInvestmentGrowth(
      bases(
        [position(ALICE, 2_000_000n), position(BOB, 100_000n)],
        [
          investment(ALICE, sip("s-a"), 1_000_000n, 1_000_000n),
          investment(ALICE, oneTime("a-1"), 1_000_000n, 1_000_000n),
          investment(BOB, oneTime("b-1"), 100_000n, 100_000n),
        ],
      ),
      {
        kind: "gain_since_invested",
        items: [
          { userId: ALICE, ref: sip("s-a"), gainSinceInvestedPaise: 100n },
          { userId: ALICE, ref: oneTime("a-1"), gainSinceInvestedPaise: -100n },
          { userId: BOB, ref: oneTime("b-1"), gainSinceInvestedPaise: 700n },
        ],
      },
    )

    expect(plan.entries.map((entry) => [entry.userId, entry.deltaPaise])).toEqual([[BOB, 700n]])
    expect(plan.skipped).toEqual([{ userId: ALICE, ref: null, reason: "unchanged" }])
  })

  test("another client's investment is refused as a target", () => {
    const two = bases(
      [position(ALICE, 100_000n), position(BOB, 100_000n)],
      [investment(ALICE, oneTime("a-1"), 100_000n, 100_000n), investment(BOB, oneTime("b-1"), 100_000n, 100_000n)],
    )

    expectAppError(
      () => planInvestmentGrowth(two, { kind: "amount", growthPaise: 100n, target: { userId: ALICE, ref: oneTime("b-1") } }),
      "VALIDATION_FAILED",
    )
    expectAppError(
      () =>
        planInvestmentGrowth(two, {
          kind: "gain_since_invested",
          items: [{ userId: BOB, ref: oneTime("a-1"), gainSinceInvestedPaise: 100n }],
        }),
      "VALIDATION_FAILED",
    )
  })

  test("a typed gain since invested sets that investment's value, overrides only its own row, and lists an unchanged row as skipped", () => {
    const plan = planInvestmentGrowth(
      bases(
        [position(ALICE, 1_700_000n)],
        [investment(ALICE, sip("s-active"), 1_000_000n, 1_100_000n), investment(ALICE, oneTime("a-1"), 500_000n, 600_000n)],
      ),
      {
        kind: "gain_since_invested",
        items: [
          { userId: ALICE, ref: sip("s-active"), gainSinceInvestedPaise: 130_000n },
          { userId: ALICE, ref: oneTime("a-1"), gainSinceInvestedPaise: 100_000n },
        ],
      },
    )

    expect(plan.entries[0]?.parts.map((part) => [part.ref, part.deltaPaise, part.afterPaise])).toEqual([
      [sip("s-active"), 30_000n, 1_130_000n],
    ])
    expect(plan.entries[0]?.deltaPaise).toBe(30_000n)
    expect(plan.skipped).toEqual([{ userId: ALICE, ref: oneTime("a-1"), reason: "unchanged" }])
  })

  test("a client who must categorise first is skipped by a rate and by typed gains, and refused for one investment", () => {
    const blocked = bases(
      [position(ALICE, 200_000n, true), position(BOB, 100_000n)],
      [
        investment(ALICE, oneTime("a-1"), 100_000n, 100_000n),
        investment(ALICE, oneTime("a-2"), 100_000n, 100_000n),
        investment(BOB, oneTime("b-1"), 100_000n, 100_000n),
      ],
    )

    const rate = planInvestmentGrowth(blocked, { kind: "percentage", growthBasisPoints: 100n, target: null })
    expect(rate.entries.map((entry) => entry.userId)).toEqual([BOB])
    expect(rate.skipped).toEqual([{ userId: ALICE, ref: null, reason: "categorise_first" }])
    const gains = planInvestmentGrowth(blocked, {
      kind: "gain_since_invested",
      items: [{ userId: ALICE, ref: oneTime("a-1"), gainSinceInvestedPaise: 5_000n }],
    })
    expect(gains.entries).toEqual([])
    expect(gains.skipped).toEqual([{ userId: ALICE, ref: null, reason: "categorise_first" }])
    expectAppError(
      () => planInvestmentGrowth(blocked, { kind: "amount", growthPaise: 100n, target: { userId: ALICE, ref: oneTime("a-1") } }),
      "STATE_CONFLICT",
    )
  })

  test("a loss that would take an investment below zero is refused rather than clamped", () => {
    expectAppError(
      () =>
        planInvestmentGrowth(
          bases([position(ALICE, 2_000_000n)], [investment(ALICE, oneTime("a-1"), 1_000_000n, 100_000n), investment(ALICE, sip("s"), 1_000_000n, 1_900_000n)]),
          { kind: "percentage", growthBasisPoints: -2_000n, target: null },
        ),
      "VALIDATION_FAILED",
    )
  })

  test("the basis hash changes when any one investment's value changes", () => {
    const changed = bases(ALICE_BASES.positions, [
      ...ALICE_BASES.investments.slice(0, 1),
      investment(ALICE, oneTime("a-333"), 333n, 401n),
      ...ALICE_BASES.investments.slice(2),
    ])

    const hash = computeInvestmentGrowthBasisHash("cmd", FUND, ALICE_BASES)
    expect(computeInvestmentGrowthBasisHash("cmd", FUND, ALICE_BASES)).toBe(hash)
    expect(computeInvestmentGrowthBasisHash("cmd", FUND, changed)).not.toBe(hash)
  })
})
