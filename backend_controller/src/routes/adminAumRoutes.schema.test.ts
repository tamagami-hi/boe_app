import { describe, expect, test } from "vitest"

import { AppError } from "../http/errorCatalog.js"
import {
  assertAumEligible,
  AUM_ELIGIBLE_FUND_STATES,
  collectiveCommitBodySchema,
  collectivePlanBodySchema,
  isAumEligible,
} from "./adminAumRoutes.js"

const MAX = 100_000
const plan = collectivePlanBodySchema(MAX)
const commit = collectiveCommitBodySchema(MAX)

const base = { asOfDate: "2026-08-01", reasonCode: "monthly_valuation" }

const codeOf = (run: () => unknown): string => {
  try {
    run()
  } catch (error) {
    return error instanceof AppError ? error.code : "NOT_AN_APP_ERROR"
  }
  return "NO_ERROR"
}

describe("AUM eligibility", () => {
  test("draft, published and paused funds may receive a publication", () => {
    expect([...AUM_ELIGIBLE_FUND_STATES]).toEqual(["draft", "published", "paused"])
    for (const state of AUM_ELIGIBLE_FUND_STATES) expect(isAumEligible(state)).toBe(true)
  })

  test("archived is the only ineligible state", () => {
    expect(isAumEligible("archived")).toBe(false)
  })

  test("a missing target is a not-found, an archived target is a conflict", () => {
    expect(codeOf(() => assertAumEligible(["a", "b"], [{ id: "a", state: "draft" }])))
      .toBe("RESOURCE_NOT_FOUND")
    expect(codeOf(() => assertAumEligible(["a"], [{ id: "a", state: "archived" }])))
      .toBe("STATE_CONFLICT")
    expect(assertAumEligible(["a"], [{ id: "a", state: "paused" }])).toBeUndefined()
  })

  test("the thrown errors are AppErrors, so the boundary renders them", () => {
    try {
      assertAumEligible(["a"], [{ id: "a", state: "archived" }])
      expect.unreachable("expected a conflict")
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
    }
  })
})

describe("collective growth request shapes", () => {
  const fundIds = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]

  test("percentage mode needs fundIds and a non-zero rate", () => {
    expect(plan.safeParse({ ...base, fundIds, growthBasisPoints: 250 }).success).toBe(true)
    expect(plan.safeParse({ ...base, fundIds, growthBasisPoints: 0 }).success).toBe(false)
  })

  test("explicit mode needs items with non-zero deltas and no fundIds", () => {
    const items = [{ fundId: fundIds[0]!, growthPaise: "-10000000" }]
    expect(plan.safeParse({ ...base, items }).success).toBe(true)
    expect(plan.safeParse({ ...base, fundIds, items }).success).toBe(false)
    expect(plan.safeParse({ ...base, items: [{ fundId: fundIds[0]!, growthPaise: "0" }] }).success)
      .toBe(false)
    expect(plan.safeParse({ ...base, items: [{ fundId: fundIds[0]!, growthPaise: "-0" }] }).success)
      .toBe(false)
  })

  test("a fund may appear at most once", () => {
    expect(plan.safeParse({ ...base, fundIds: [fundIds[0]!, fundIds[0]!], growthBasisPoints: 10 }).success)
      .toBe(false)
    expect(plan.safeParse({
      ...base,
      items: [
        { fundId: fundIds[0]!, growthPaise: "1" },
        { fundId: fundIds[0]!, growthPaise: "2" },
      ],
    }).success).toBe(false)
  })

  test("the rate is bounded on both sides", () => {
    expect(plan.safeParse({ ...base, fundIds, growthBasisPoints: MAX }).success).toBe(true)
    expect(plan.safeParse({ ...base, fundIds, growthBasisPoints: MAX + 1 }).success).toBe(false)
    expect(plan.safeParse({ ...base, fundIds, growthBasisPoints: -10_000 }).success).toBe(true)
    expect(plan.safeParse({ ...base, fundIds, growthBasisPoints: -10_001 }).success).toBe(false)
  })

  test("commit additionally requires the plan's basis hash", () => {
    const percentage = { ...base, fundIds, growthBasisPoints: 250 }
    expect(commit.safeParse(percentage).success).toBe(false)
    expect(commit.safeParse({ ...percentage, basisHash: "a".repeat(64) }).success).toBe(true)
    expect(commit.safeParse({ ...percentage, basisHash: "A".repeat(64) }).success).toBe(false)
  })

  test("unknown keys are rejected rather than ignored", () => {
    expect(plan.safeParse({ ...base, fundIds, growthBasisPoints: 250, totalPaise: "1" }).success)
      .toBe(false)
  })
})
