import { describe, expect, test } from "vitest"

import { renderEmailTemplate, type EmailTemplateConfig } from "./emailTemplates.js"

const CONFIG: EmailTemplateConfig = { supportAddress: "support@beonedge.example" }

const SIP = {
  template: "sip_payment_recorded",
  entryId: "11111111-1111-4111-8111-111111111111",
  scheduleId: "22222222-2222-4222-8222-222222222222",
  effectiveDate: "2026-03-04",
  sipMonth: "2026-03",
  monthNumber: 3,
  monthCount: 12,
  nextMonth: "2026-04",
  fullName: "Ada Lovelace",
  fundName: "Harbour Growth Fund",
  amountPaise: "1234550",
}

const ONE_TIME = {
  template: "one_time_investment_recorded",
  entryId: "11111111-1111-4111-8111-111111111111",
  effectiveDate: "2026-06-02",
  fullName: "Ada Lovelace",
  fundName: "Harbour Growth Fund",
  amountPaise: "25000000",
}

const rendered = (key: string, data: Readonly<Record<string, unknown>>) => {
  const result = renderEmailTemplate(key, "v1", data, CONFIG)
  if (result.kind !== "rendered") throw new Error(`expected a rendered email, got ${result.errorCode}`)
  return result.email
}

describe("SIP payment recorded email", () => {
  test("names the fund, the amount in Indian grouping, the month as N of M and the next month due", () => {
    const email = rendered("sip_payment_recorded", SIP)

    expect(email.subject).toBe("SIP payment recorded")
    expect(email.text).toContain("Hello Ada Lovelace,")
    expect(email.text).toContain(
      "Your SIP payment of ₹12,345.50 in Harbour Growth Fund, dated 4 March 2026, has been added to your BeOnEdge app.",
    )
    expect(email.text).toContain("It is recorded for March 2026, month 3 of 12 of this SIP.")
    expect(email.text).toContain("The next month due is April 2026.")
    expect(email.html).toContain("It is recorded for March 2026, month 3 of 12 of this SIP.")
    expect(email.text).toContain("Investments are subject to market risk.")
    expect(`${email.subject}${email.text}`).not.toContain("!")
  })

  test("says every month is recorded when no month is left", () => {
    const email = rendered("sip_payment_recorded", { ...SIP, monthNumber: 12, nextMonth: null })

    expect(email.text).toContain("Every month of this SIP is now recorded.")
    expect(email.text).not.toContain("next month")
  })

  test.each([
    ["a month number above the month count", { monthNumber: 13 }],
    ["a month number of zero", { monthNumber: 0 }],
    ["a fractional month count", { monthCount: 12.5 }],
    ["a month count written as text", { monthCount: "12" }],
    ["a missing next month", { nextMonth: undefined }],
    ["an impossible next month", { nextMonth: "2026-13" }],
    ["a SIP month with a day", { sipMonth: "2026-03-01" }],
    ["a fractional amount", { amountPaise: "1234.50" }],
  ])("refuses %s rather than guessing", (_label, override) => {
    expect(renderEmailTemplate("sip_payment_recorded", "v1", { ...SIP, ...override }, CONFIG)).toEqual({
      kind: "unrenderable",
      errorCode: "EMAIL_TEMPLATE_DATA_INVALID",
    })
  })
})

describe("one-time investment recorded email", () => {
  test("names the fund, the amount and the date", () => {
    const email = rendered("one_time_investment_recorded", ONE_TIME)

    expect(email.subject).toBe("One-time investment recorded")
    expect(email.text).toContain(
      "Your one-time investment of ₹2,50,000.00 in Harbour Growth Fund, dated 2 June 2026, has been added to your BeOnEdge app.",
    )
    expect(email.text).toContain("If you do not recognise this investment, contact BeOnEdge support.")
    expect(email.text).toContain("Investments are subject to market risk.")
  })

  test("renders only the version it was queued with", () => {
    expect(renderEmailTemplate("one_time_investment_recorded", "v2", ONE_TIME, CONFIG)).toEqual({
      kind: "unrenderable",
      errorCode: "TEMPLATE_VERSION_UNSUPPORTED",
    })
  })
})
