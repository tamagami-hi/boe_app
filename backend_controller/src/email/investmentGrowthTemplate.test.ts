import { describe, expect, test } from "vitest"

import { renderEmailTemplate, type EmailTemplateConfig } from "./emailTemplates.js"

const CONFIG: EmailTemplateConfig = { supportAddress: "support@beonedge.example" }

const DATA = {
  template: "investment_growth",
  effectiveDate: "2026-08-20",
  fullName: "Ada Lovelace",
  fundName: "Harbour Growth Fund",
  deltaPaise: "250000",
  valueAfterPaise: "10250000",
}

const rendered = (data: Readonly<Record<string, unknown>>, config: EmailTemplateConfig = CONFIG) => {
  const result = renderEmailTemplate("investment_growth", "v1", data, config)
  if (result.kind !== "rendered") throw new Error(`expected a rendered email, got ${result.errorCode}`)
  return result.email
}

describe("investment growth email", () => {
  test("a gain names the fund, the change, the value after it, the date, Portfolio and the market-risk line", () => {
    const email = rendered(DATA)

    expect(email.subject).toBe("Investment value updated")
    expect(email.text).toContain("Hello Ada Lovelace,")
    expect(email.text).toContain(
      "The value of your investment in Harbour Growth Fund was updated as of 20 August 2026. This update is a gain of ₹2,500.00.",
    )
    expect(email.text).toContain("Your value in this fund is now ₹1,02,500.00.")
    expect(email.html).toContain("Your value in this fund is now ₹1,02,500.00.")
    expect(email.text).toContain("Open the BeOnEdge app and go to Portfolio to see your current value.")
    expect(email.text).toContain("Investments are subject to market risk.")
    expect(email.text).toContain("support@beonedge.example")
    expect(`${email.subject}${email.text}`).not.toContain("!")
    expect(email.html).toContain("This update is a gain of ₹2,500.00.")
  })

  test("a loss is said as a loss of its size, never as a gain or a negative figure", () => {
    const email = rendered({ ...DATA, deltaPaise: "-123456", valueAfterPaise: "876544" })

    expect(email.text).toContain("This update is a loss of ₹1,234.56.")
    expect(email.text).toContain("Your value in this fund is now ₹8,765.44.")
    expect(email.text).not.toContain("gain")
    expect(email.text).not.toContain("-₹")
  })

  test("adds the web-app line only from configuration", () => {
    const withLink = rendered({ ...DATA, webAppUrl: "https://forged.example" }, { ...CONFIG, webAppUrl: "https://app.beonedge.example" })

    expect(withLink.text).toContain("On an iPhone or a computer, you can open the BeOnEdge web app at https://app.beonedge.example/")
    expect(rendered(DATA).text).not.toContain("web app")
    expect(withLink.text).not.toContain("forged.example")
  })

  test.each([
    ["a zero change", { deltaPaise: "0" }],
    ["a negative zero change", { deltaPaise: "-0" }],
    ["a fractional change", { deltaPaise: "2500.50" }],
    ["an exponent change", { deltaPaise: "25e4" }],
    ["a plus-signed change", { deltaPaise: "+250000" }],
    ["a number instead of paise text", { deltaPaise: 250000 }],
    ["a negative value after", { valueAfterPaise: "-1" }],
    ["a fractional value after", { valueAfterPaise: "102500.00" }],
    ["no fund name", { fundName: "" }],
    ["an impossible date", { effectiveDate: "2026-13-01" }],
  ])("refuses %s rather than guessing a figure", (_label, override) => {
    expect(renderEmailTemplate("investment_growth", "v1", { ...DATA, ...override }, CONFIG)).toEqual({
      kind: "unrenderable",
      errorCode: "EMAIL_TEMPLATE_DATA_INVALID",
    })
  })

  test("renders only the version it was queued with", () => {
    expect(renderEmailTemplate("investment_growth", "v2", DATA, CONFIG)).toEqual({
      kind: "unrenderable",
      errorCode: "TEMPLATE_VERSION_UNSUPPORTED",
    })
  })
})
