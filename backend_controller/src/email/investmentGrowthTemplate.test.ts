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

  test("renders only the versions it knows", () => {
    expect(renderEmailTemplate("investment_growth", "v3", DATA, CONFIG)).toEqual({
      kind: "unrenderable",
      errorCode: "TEMPLATE_VERSION_UNSUPPORTED",
    })
  })
})

const PARTS_DATA = {
  ...DATA,
  deltaPaise: "18000",
  valueAfterPaise: "10268000",
  parts: [
    { kind: "sip", deltaPaise: "12000" },
    { kind: "one_time", investedPaise: "2500000", effectiveDate: "2026-06-02", deltaPaise: "30000" },
    { kind: "investment", investedPaise: "100000", effectiveDate: "2026-07-15", deltaPaise: "-24000" },
  ],
}

const renderedV2 = (data: Readonly<Record<string, unknown>>) => {
  const result = renderEmailTemplate("investment_growth", "v2", data, CONFIG)
  if (result.kind !== "rendered") throw new Error(`expected a rendered email, got ${result.errorCode}`)
  return result.email
}

describe("investment growth email v2", () => {
  test("lists each investment's change, then the net and the new value", () => {
    const email = renderedV2(PARTS_DATA)

    const text = email.text
    expect(text).toContain("The value of your investments in Harbour Growth Fund was updated as of 20 August 2026.")
    expect(text).toContain("Your SIP: a gain of ₹120.00.")
    expect(text).toContain("Your one-time investment of ₹25,000.00 from 2 June 2026: a gain of ₹300.00.")
    expect(text).toContain("Your investment of ₹1,000.00 from 15 July 2026: a loss of ₹240.00.")
    expect(text).toContain("In total, this update is a gain of ₹180.00.")
    expect(text).toContain("Your value in this fund is now ₹1,02,680.00.")
    expect(text.indexOf("Your SIP")).toBeLessThan(text.indexOf("In total"))
    expect(text.indexOf("In total")).toBeLessThan(text.indexOf("Your value in this fund"))
    expect(text).toContain("Investments are subject to market risk.")
    expect(text).not.toContain("-₹")
    expect(email.html).toContain("Your SIP: a gain of ₹120.00.")
  })

  test("a v1 row queued before the upgrade still renders as one change", () => {
    const result = renderEmailTemplate("investment_growth", "v1", DATA, CONFIG)

    expect(result.kind).toBe("rendered")
    expect(result.kind === "rendered" ? result.email.text : "").toContain("This update is a gain of ₹2,500.00.")
  })

  test.each([
    ["parts that do not add up to the net", { deltaPaise: "18001" }],
    ["no parts", { parts: [] }],
    ["parts that are not a list", { parts: "12000" }],
    ["an unknown kind", { parts: [{ kind: "bond", investedPaise: "1", effectiveDate: "2026-06-02", deltaPaise: "18000" }] }],
    ["a zero part", { deltaPaise: "12000", parts: [{ kind: "sip", deltaPaise: "12000" }, { kind: "sip", deltaPaise: "0" }] }],
    ["a one-time part without its date", { deltaPaise: "30000", parts: [{ kind: "one_time", investedPaise: "2500000", deltaPaise: "30000" }] }],
  ])("refuses %s rather than guessing a figure", (_label, override) => {
    expect(renderEmailTemplate("investment_growth", "v2", { ...PARTS_DATA, ...override }, CONFIG)).toEqual({
      kind: "unrenderable",
      errorCode: "EMAIL_TEMPLATE_DATA_INVALID",
    })
  })
})
