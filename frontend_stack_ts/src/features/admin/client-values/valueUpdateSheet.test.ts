import { describe, expect, it } from "vitest"

import {
  BELOW_ZERO_MESSAGE,
  FORMAT_MESSAGE,
  NO_VALUE_MESSAGE,
  planSheet,
  previewMatchesSheet,
} from "./valueUpdateSheet"
import type { SheetPosition } from "./valueUpdateSheet"

const ASHA: SheetPosition = {
  userId: "asha",
  fullName: "Asha Rao",
  accountState: "active",
  investedPaise: "1000000",
  currentValuePaise: "1052525",
  gainPaise: "52525",
}
const BALA: SheetPosition = {
  userId: "bala",
  fullName: "Bala Iyer",
  accountState: "active",
  investedPaise: "250000",
  currentValuePaise: "239999",
  gainPaise: "-10001",
}
const CHITRA: SheetPosition = {
  userId: "chitra",
  fullName: "Chitra Nair",
  accountState: "active",
  investedPaise: "500000",
  currentValuePaise: "0",
  gainPaise: "-500000",
}
const DEV: SheetPosition = {
  userId: "dev",
  fullName: "Dev Shah",
  accountState: "active",
  investedPaise: "300000",
  currentValuePaise: "300000",
  gainPaise: "0",
}
const SHEET = [ASHA, BALA, CHITRA, DEV]

describe("monthly value-update sheet arithmetic", () => {
  it("turns typed gains into exact paise changes, negative ones included, and skips unchanged rows", () => {
    const plan = planSheet(SHEET, { asha: "1234.5", bala: "-250.75", dev: "0", chitra: "" })

    expect(plan.changes).toEqual([
      { userId: "asha", growthPaise: "70925" },
      { userId: "bala", growthPaise: "-15074" },
    ])
    expect(plan.rows.get("asha")).toEqual({ kind: "change", changePaise: "70925", newValuePaise: "1123450" })
    expect(plan.rows.get("bala")).toEqual({ kind: "change", changePaise: "-15074", newValuePaise: "224925" })
    expect(plan.rows.get("dev")).toEqual({ kind: "unchanged" })
    expect(plan.totalChangePaise).toBe("55851")
    expect(plan.invalidCount).toBe(0)
  })

  it("converts rupee text without floating-point drift", () => {
    const plan = planSheet([DEV], { dev: "10.29" })
    expect(plan.changes).toEqual([{ userId: "dev", growthPaise: "1029" }])
    expect(planSheet([DEV], { dev: "-0.07" }).changes).toEqual([{ userId: "dev", growthPaise: "-7" }])
    expect(planSheet([ASHA], { asha: "525.25" }).changes).toEqual([])
  })

  it("refuses amounts it cannot read exactly instead of rounding them", () => {
    for (const text of ["1.234", "1,000", "abc", "--5", "₹100"]) {
      const plan = planSheet([DEV], { dev: text })
      expect(plan.rows.get("dev"), text).toEqual({ kind: "invalid", message: FORMAT_MESSAGE })
      expect(plan.changes, text).toEqual([])
    }
  })

  it("refuses a change on a zero-value position and a gain that takes the value below zero", () => {
    const plan = planSheet(SHEET, { chitra: "10", bala: "-2500.01" })
    expect(plan.rows.get("chitra")).toEqual({ kind: "invalid", message: NO_VALUE_MESSAGE })
    expect(plan.rows.get("bala")).toEqual({ kind: "invalid", message: BELOW_ZERO_MESSAGE })
    expect(plan.invalidCount).toBe(2)
    expect(plan.changes).toEqual([])
  })

  it("accepts a preview only when the server's numbers are the ones the sheet was computed from", () => {
    const changes = [{ userId: "asha", growthPaise: "70925" }]
    const target = { userId: "asha", principalPaise: "1000000", beforePaise: "1052525", deltaPaise: "70925" }
    expect(previewMatchesSheet(SHEET, changes, [target])).toBe(true)
    expect(previewMatchesSheet(SHEET, changes, [{ ...target, beforePaise: "1052526" }])).toBe(false)
    expect(previewMatchesSheet(SHEET, changes, [{ ...target, deltaPaise: "70924" }])).toBe(false)
    expect(previewMatchesSheet(SHEET, changes, [])).toBe(false)
  })
})
