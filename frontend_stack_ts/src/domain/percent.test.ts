import { describe, expect, it } from "vitest"

import { PERCENT_ABSENT, formatPercent } from "~/domain/percent"

describe("formatPercent", () => {
  it("renders two fraction digits", () => {
    expect(formatPercent(12.3456)).toBe("12.35%")
    expect(formatPercent(12)).toBe("12.00%")
    expect(formatPercent(0.004)).toBe("0.00%")
  })

  it("renders a leading minus for negative values without an explicit sign request", () => {
    expect(formatPercent(-3.5)).toBe("-3.50%")
    expect(formatPercent(-3.5, { showSign: true })).toBe("-3.50%")
  })

  it("adds a plus only for strictly positive values when a sign is requested", () => {
    expect(formatPercent(3.5, { showSign: true })).toBe("+3.50%")
    expect(formatPercent(0, { showSign: true })).toBe("0.00%")
    expect(formatPercent(3.5)).toBe("3.50%")
  })

  it("renders an absent marker for null and non-finite values", () => {
    expect(formatPercent(null)).toBe(PERCENT_ABSENT)
    expect(formatPercent(Number.NaN)).toBe(PERCENT_ABSENT)
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe(PERCENT_ABSENT)
  })

  it("groups large values", () => {
    expect(formatPercent(1234.5)).toBe("1,234.50%")
  })
})
