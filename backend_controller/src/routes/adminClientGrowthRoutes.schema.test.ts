import { describe, expect, test } from "vitest"

import { buildClientGrowthSchemas } from "./adminClientGrowthRoutes.js"

const USER_ID = "11111111-1111-4111-8111-111111111111"
const FUND_ID = "22222222-2222-4222-8222-222222222222"
const BASIS_HASH = "a".repeat(64)

const { individualSchema, collectivePreviewSchema, collectiveCommitSchema } = buildClientGrowthSchemas()

const individual = (overrides: Readonly<Record<string, unknown>>): Record<string, unknown> => ({
  userId: USER_ID,
  fundId: FUND_ID,
  growthPaise: "25000",
  effectiveDate: "2026-08-20",
  reasonCode: "performance_update",
  ...overrides,
})

const explicitItems = (growthPaise: string): Record<string, unknown> => ({
  fundId: FUND_ID,
  items: [{ userId: USER_ID, growthPaise }],
})

const collectiveCommit = (overrides: Readonly<Record<string, unknown>>): Record<string, unknown> => ({
  fundId: FUND_ID,
  growthBasisPoints: 250,
  basisHash: BASIS_HASH,
  effectiveDate: "2026-08-20",
  reasonCode: "quarterly_valuation",
  ...overrides,
})

const REFUSED_AMOUNTS = [
  "0",
  "-0",
  "007",
  "-007",
  "9223372036854775808",
  "-9223372036854775808",
  "99999999999999999999",
  "1.5",
]

const IMPOSSIBLE_DATES = ["2026-13-45", "2026-02-30", "2025-02-29", "2026-04-31", "2026-00-10"]

describe("client growth amounts", () => {
  test("accept canonical non-zero signed paise up to the bigint bound", () => {
    for (const growthPaise of ["1", "-1", "25000", "9223372036854775807", "-9223372036854775807"]) {
      expect(individualSchema.safeParse(individual({ growthPaise })).success, growthPaise).toBe(true)
      expect(collectivePreviewSchema.safeParse(explicitItems(growthPaise)).success, growthPaise).toBe(true)
    }
  })

  test("refuse zero, non-canonical and out-of-range paise on every growth body", () => {
    for (const growthPaise of REFUSED_AMOUNTS) {
      expect(individualSchema.safeParse(individual({ growthPaise })).success, growthPaise).toBe(false)
      expect(collectivePreviewSchema.safeParse(explicitItems(growthPaise)).success, growthPaise).toBe(false)
      expect(
        collectiveCommitSchema.safeParse(
          collectiveCommit({ growthBasisPoints: undefined, ...explicitItems(growthPaise) }),
        ).success,
        growthPaise,
      ).toBe(false)
    }
  })
})

describe("client growth effective dates", () => {
  test("refuse a date that does not exist on the calendar", () => {
    for (const effectiveDate of IMPOSSIBLE_DATES) {
      expect(individualSchema.safeParse(individual({ effectiveDate })).success, effectiveDate).toBe(false)
      expect(collectiveCommitSchema.safeParse(collectiveCommit({ effectiveDate })).success, effectiveDate).toBe(
        false,
      )
    }
  })

  test("accept a real leap day", () => {
    expect(individualSchema.safeParse(individual({ effectiveDate: "2028-02-29" })).success).toBe(true)
    expect(collectiveCommitSchema.safeParse(collectiveCommit({ effectiveDate: "2028-02-29" })).success).toBe(true)
  })
})
