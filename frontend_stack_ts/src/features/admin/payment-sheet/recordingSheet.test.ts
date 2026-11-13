import { describe, expect, it } from "vitest"

import { AMOUNT_MESSAGE, DATE_MESSAGE, checkDraft, recordingBodyOf } from "./recordingSheet"
import type { SheetSchedule } from "./recordingSheet"
import { NOT_FILLABLE_MESSAGE, NO_MATCH_MESSAGE, SHAPE_MESSAGE, matchCsv } from "./recordingSheetCsv"

const TODAY = "2026-11-13"

const schedule = (scheduleId: string, userId: string, clientEmail: string, fundId: string): SheetSchedule => ({
  scheduleId,
  userId,
  clientName: clientEmail.split("@")[0] ?? "",
  clientEmail,
  fundId,
  fundName: "Fund",
  monthlyAmountPaise: "500000",
  startMonth: "2026-01",
  monthCount: 12,
  recorded: null,
})

const ASHA_BALANCED = schedule("a1a1a1a1-0000-4000-8000-000000000001", "a0a0a0a0-0000-4000-8000-00000000000a", "asha@example.com", "f1")
const ASHA_EQUITY = schedule("a2a2a2a2-0000-4000-8000-000000000002", "a0a0a0a0-0000-4000-8000-00000000000a", "asha@example.com", "f2")
const BALA = schedule("b1b1b1b1-0000-4000-8000-000000000003", "b0b0b0b0-0000-4000-8000-00000000000b", "bala@example.com", "f1")
const CHITRA = schedule("c1c1c1c1-0000-4000-8000-000000000004", "c0c0c0c0-0000-4000-8000-00000000000c", "chitra@example.com", "f1")
const ROWS = [ASHA_BALANCED, ASHA_EQUITY, BALA, CHITRA]

const draft = (amountText: string, dateText = TODAY) => ({ selected: true, amountText, dateText })

describe("payment sheet rupee amounts", () => {
  it("turns rupee text into exact integer paise, including amounts floats get wrong", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["10", "1000"],
      ["10.5", "1050"],
      ["10.50", "1050"],
      ["5000", "500000"],
      ["2500.5", "250050"],
      ["10.29", "1029"],
      ["0.07", "7"],
      [" 1250.50 ", "125050"],
      ["99999999.99", "9999999999"],
    ]
    for (const [text, paise] of cases) {
      expect(checkDraft(draft(text), TODAY), text).toEqual({ kind: "ready", amountPaise: paise, effectiveDate: TODAY })
    }
  })

  it("refuses text it cannot read exactly instead of rounding it", () => {
    const refused = ["1e3", "-5", "1,000", "1.234", " 1 0", "₹10", ".5", "10.", "+10", "0", "0.00", "01", "abc", ""]
    for (const text of refused) {
      expect(checkDraft(draft(text), TODAY), text).toEqual({ kind: "invalid", amountError: AMOUNT_MESSAGE, dateError: null })
    }
  })

  it("refuses a future, impossible or misformatted date", () => {
    for (const dateText of ["2026-11-14", "2026-02-30", "13-11-2026", ""]) {
      expect(checkDraft(draft("100", dateText), TODAY), dateText).toEqual({
        kind: "invalid",
        amountError: null,
        dateError: DATE_MESSAGE,
      })
    }
  })

  it("builds a monthly investment linked to the schedule month", () => {
    expect(recordingBodyOf(BALA, "2026-11", { amountPaise: "500050", effectiveDate: TODAY })).toEqual({
      fundId: "f1",
      amountPaise: "500050",
      effectiveDate: TODAY,
      reasonCode: "recorded_offline_monthly_investment",
      sipScheduleLink: { scheduleId: BALA.scheduleId, month: "2026-11" },
    })
  })
})

describe("payment sheet CSV paste", () => {
  it("fills only rows it matches exactly and lists every other line with its reason", () => {
    const text = [
      "BALA@Example.com, 5000.50, 2026-11-02",
      `${ASHA_EQUITY.scheduleId}\t2500`,
      "asha@example.com,1000",
      "nobody@example.com,1000",
      `${BALA.userId},100`,
      `${CHITRA.scheduleId},100`,
      `${ASHA_BALANCED.scheduleId},1.234`,
      `${ASHA_BALANCED.scheduleId},"1,000"`,
      "",
      `${ASHA_BALANCED.scheduleId},100,2099-01-01`,
      "just-one-field",
    ].join("\n")

    const match = matchCsv(text, ROWS, (scheduleId) => scheduleId !== CHITRA.scheduleId, TODAY)

    expect(match.fills).toEqual([
      { line: 1, scheduleId: BALA.scheduleId, amountText: "5000.50", dateText: "2026-11-02" },
      { line: 2, scheduleId: ASHA_EQUITY.scheduleId, amountText: "2500", dateText: null },
    ])
    expect(match.problems.map((problem) => [problem.line, problem.reason])).toEqual([
      [3, "This client has 2 schedules on this sheet. Use the schedule id, or choose a fund first."],
      [4, NO_MATCH_MESSAGE],
      [5, "Line 1 already fills this row."],
      [6, NOT_FILLABLE_MESSAGE],
      [7, AMOUNT_MESSAGE],
      [8, AMOUNT_MESSAGE],
      [10, DATE_MESSAGE],
      [11, SHAPE_MESSAGE],
    ])
  })

  it("matches a client by id when the client has one schedule on the sheet", () => {
    const match = matchCsv(`${BALA.userId},750`, ROWS, () => true, TODAY)
    expect(match.fills).toEqual([{ line: 1, scheduleId: BALA.scheduleId, amountText: "750", dateText: null }])
    expect(match.problems).toEqual([])
  })
})
