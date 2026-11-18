import { describe, expect, it } from "vitest"

import {
  BELOW_ZERO_MESSAGE,
  FORMAT_MESSAGE,
  NO_VALUE_MESSAGE,
  overrideRow,
  planSheet,
  prefillFromRate,
  previewMatchesSheet,
  sheetCommitBody,
} from "./valueUpdateSheet"
import type { SheetRow } from "./valueUpdateSheet"

type Figures = Readonly<{ investedPaise: string; currentValuePaise: string; gainPaise: string }>

const row = (userId: string, investment: string, figures: Figures, categoriseFirst = false): SheetRow => ({
  userId,
  fullName: userId,
  accountState: "active",
  investedPaise: figures.investedPaise,
  positionValuePaise: figures.currentValuePaise,
  rowKey: `${userId}|${investment}`,
  ref: { kind: "one_time", allocationId: investment },
  label: investment,
  date: "2026-06-02",
  categoriseFirst,
})

const ASHA = row("asha", "a1", { investedPaise: "1000000", currentValuePaise: "1052525", gainPaise: "52525" })
const BALA = row("bala", "b1", { investedPaise: "250000", currentValuePaise: "239999", gainPaise: "-10001" })
const CHITRA = row("chitra", "c1", { investedPaise: "500000", currentValuePaise: "0", gainPaise: "-500000" })
const DEV = row("dev", "d1", { investedPaise: "300000", currentValuePaise: "300000", gainPaise: "0" })
const SHEET = [ASHA, BALA, CHITRA, DEV]

describe("monthly value-update sheet arithmetic", () => {
  it("turns typed gains since invested into exact paise, negative ones included, and skips blank rows", () => {
    const plan = planSheet(SHEET, { "asha|a1": "1234.5", "bala|b1": "-250.75", "dev|d1": "10.29", "chitra|c1": "" })

    expect(plan.changes.map(({ userId, gainSinceInvestedPaise }) => [userId, gainSinceInvestedPaise])).toEqual([
      ["asha", "123450"],
      ["bala", "-25075"],
      ["dev", "1029"],
    ])
    expect(plan.rows.get("asha|a1")).toEqual({ kind: "set", gainSinceInvestedPaise: "123450", newValuePaise: "1123450" })
    expect(plan.rows.get("chitra|c1")).toEqual({ kind: "unchanged" })
    expect(plan.invalidCount).toBe(0)
  })

  it("refuses amounts it cannot read exactly, a change on a zero-value row and a gain below zero", () => {
    for (const text of ["1.234", "1,000", "abc", "--5", "₹100"]) {
      expect(planSheet([DEV], { "dev|d1": text }).rows.get("dev|d1"), text).toEqual({ kind: "invalid", message: FORMAT_MESSAGE })
    }
    const plan = planSheet(SHEET, { "chitra|c1": "10", "bala|b1": "-2500.01" })
    expect(plan.rows.get("chitra|c1")).toEqual({ kind: "invalid", message: NO_VALUE_MESSAGE })
    expect(plan.rows.get("bala|b1")).toEqual({ kind: "invalid", message: BELOW_ZERO_MESSAGE })
    expect(plan.changes).toEqual([])
  })
})

describe("per-investment fund rate, overrides and clients to categorise", () => {
  const SIP = row("esha", "sip", { investedPaise: "1000000", currentValuePaise: "1000000", gainPaise: "0" })
  const LUMP = row("esha", "lump", { investedPaise: "333", currentValuePaise: "333", gainPaise: "0" })
  const PAISA = row("farid", "p1", { investedPaise: "1", currentValuePaise: "1", gainPaise: "0" })

  it("pre-fills each row with invested times the rate, rounded half away from zero in paise", () => {
    expect(prefillFromRate([SIP, LUMP, PAISA], 250)).toEqual({ "esha|sip": "250", "esha|lump": "0.08", "farid|p1": "0" })
    expect(prefillFromRate([LUMP, PAISA], 150)).toEqual({ "esha|lump": "0.05", "farid|p1": "0" })
    expect(prefillFromRate([LUMP, PAISA], -150)).toEqual({ "esha|lump": "-0.05", "farid|p1": "0" })
    expect(prefillFromRate([PAISA], 5_000)).toEqual({ "farid|p1": "0.01" })
    expect(prefillFromRate([PAISA], -5_000)).toEqual({ "farid|p1": "-0.01" })
  })

  it("replaces only the overridden row and leaves the same client's other investment on the rate", () => {
    const filled = prefillFromRate([SIP, LUMP, PAISA], 250)
    const plan = planSheet([SIP, LUMP, PAISA], overrideRow(filled, "esha|lump", "12.34"))

    expect(plan.changes.map(({ rowKey, gainSinceInvestedPaise }) => [rowKey, gainSinceInvestedPaise])).toEqual([
      ["esha|sip", "25000"],
      ["esha|lump", "1234"],
      ["farid|p1", "0"],
    ])
  })

  it("leaves rows of clients still to categorise out of the commit body and counts them", () => {
    const waiting = [
      row("gita", "g1", { investedPaise: "500000", currentValuePaise: "500000", gainPaise: "0" }, true),
      row("gita", "g2", { investedPaise: "200000", currentValuePaise: "200000", gainPaise: "0" }, true),
    ]
    const rows = [SIP, ...waiting]
    const typed = { ...prefillFromRate(rows, 250), "gita|g1": "900", "gita|g2": "100" }
    const plan = planSheet(rows, typed)
    const body = sheetCommitBody("fund", plan.changes, {
      basisHash: "a".repeat(64),
      effectiveDate: "2026-11-18",
      reasonCode: "monthly",
      note: "",
    })

    expect(plan.rows.get("gita|g1")).toEqual({ kind: "categorise_first" })
    expect(plan.skippedRowCount).toBe(2)
    expect(plan.skippedClientCount).toBe(1)
    expect("items" in body ? body.items : []).toEqual([
      { userId: "esha", ref: { kind: "one_time", allocationId: "sip" }, gainSinceInvestedPaise: "25000" },
    ])
  })

  it("accepts a preview only when every part matches its row's invested amount and typed gain, and parts sum to the entry", () => {
    const plan = planSheet([SIP, LUMP], { "esha|sip": "250", "esha|lump": "1" })
    const part = (investment: string, invested: string, before: string, after: string) => ({
      ref: { kind: "one_time" as const, allocationId: investment },
      label: investment,
      investedPaise: invested,
      beforePaise: before,
      deltaPaise: String(BigInt(after) - BigInt(before)),
      afterPaise: after,
    })
    const parts = [part("sip", "1000000", "1010000", "1025000"), part("lump", "333", "333", "433")]
    const entry = { userId: "esha", beforePaise: "1010333", deltaPaise: "15100", afterPaise: "1025433", parts }

    expect(previewMatchesSheet([SIP, LUMP], plan.changes, [entry], [])).toBe(true)
    expect(previewMatchesSheet([SIP, LUMP], plan.changes, [{ ...entry, deltaPaise: "15099" }], [])).toBe(false)
    expect(previewMatchesSheet([SIP, LUMP], plan.changes, [{ ...entry, parts: [parts[0]!, part("lump", "333", "333", "434")] }], [])).toBe(false)
    expect(previewMatchesSheet([SIP, LUMP], plan.changes, [{ ...entry, parts: [parts[0]!, part("lump", "334", "334", "434")] }], [])).toBe(false)
  })

  it("refuses a preview that drops or repeats a typed row unless the server lists that row as skipped", () => {
    const plan = planSheet([SIP, LUMP], { "esha|sip": "250", "esha|lump": "1" })
    const sip = { ref: SIP.ref!, label: "sip", investedPaise: "1000000", beforePaise: "1010000", deltaPaise: "15000", afterPaise: "1025000" }
    const dropped = { userId: "esha", beforePaise: "1010000", deltaPaise: "15000", afterPaise: "1025000", parts: [sip] }
    const repeated = { userId: "esha", beforePaise: "2020000", deltaPaise: "30000", afterPaise: "2050000", parts: [sip, sip] }

    expect(previewMatchesSheet([SIP, LUMP], plan.changes, [dropped], [])).toBe(false)
    expect(previewMatchesSheet([SIP, LUMP], plan.changes, [repeated], [{ userId: "esha", ref: LUMP.ref, reason: "unchanged" }])).toBe(false)
    expect(previewMatchesSheet([SIP, LUMP], plan.changes, [dropped], [{ userId: "esha", ref: LUMP.ref, reason: "unchanged" }])).toBe(true)
  })
})
