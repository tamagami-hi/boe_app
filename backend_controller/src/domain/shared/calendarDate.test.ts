import { describe, expect, test } from "vitest"

import { AppError } from "../../http/errorCatalog.js"
import { indiaCalendarDate, refuseFutureDate } from "./calendarDate.js"

const refusalOf = (run: () => void): AppError | null => {
  try {
    run()
  } catch (error) {
    if (error instanceof AppError) return error
    throw error
  }
  return null
}

describe("the India calendar day", () => {
  test("turns over at 18:30 UTC rather than at UTC midnight", () => {
    expect(indiaCalendarDate(new Date("2026-11-13T18:29:59.999Z"))).toBe("2026-11-13")
    expect(indiaCalendarDate(new Date("2026-11-13T18:30:00.000Z"))).toBe("2026-11-14")
    expect(indiaCalendarDate(new Date("2026-12-31T20:00:00.000Z"))).toBe("2027-01-01")
  })
})

describe("refusing a future date", () => {
  const halfPastMidnightInIndia = new Date("2026-11-13T19:00:00.000Z")

  test("accepts today and earlier in India while UTC is still on the previous day", () => {
    expect(refusalOf(() => { refuseFutureDate("effectiveDate", "2026-11-14", halfPastMidnightInIndia) })).toBeNull()
    expect(refusalOf(() => { refuseFutureDate("effectiveDate", "2026-11-13", halfPastMidnightInIndia) })).toBeNull()
  })

  test("refuses tomorrow in India as a validation failure on the named field", () => {
    const refusal = refusalOf(() => { refuseFutureDate("asOfDate", "2026-11-15", halfPastMidnightInIndia) })
    expect(refusal?.code).toBe("VALIDATION_FAILED")
    expect(Object.keys(refusal?.fields ?? {})).toEqual(["asOfDate"])
  })
})
