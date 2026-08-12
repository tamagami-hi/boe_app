import { describe, expect, test } from "vitest"

import { renderEmailTemplate, type EmailTemplateConfig } from "./emailTemplates.js"

const CONFIG: EmailTemplateConfig = {
  supportAddress: "support@beonedge.example",
}

const APK_URL = "https://downloads.beonedge.example/client/boe.apk"

describe("renderEmailTemplate", () => {
  test("approval carries the app download link when one was published", () => {
    const result = renderEmailTemplate("account_approved", { downloadUrl: APK_URL }, CONFIG)
    expect(result.kind).toBe("rendered")
    if (result.kind !== "rendered") return
    expect(result.email.subject).toContain("approved")
    expect(result.email.text).toContain(APK_URL)
    expect(result.email.text).toContain("email address and password")
    expect(result.email.text).toContain("support@beonedge.example")
  })

  test("approval still renders without a download link", () => {
    const result = renderEmailTemplate("account_approved", {}, CONFIG)
    expect(result.kind).toBe("rendered")
    if (result.kind !== "rendered") return
    expect(result.email.text).not.toContain("http")
    expect(result.email.text).toContain("email address and password")
  })

  test("approval mentions the in-app verification step", () => {
    const result = renderEmailTemplate("account_approved", { downloadUrl: APK_URL }, CONFIG)
    if (result.kind !== "rendered") throw new Error("expected a rendered email")
    expect(result.email.text).toContain("verify your email address")
  })

  test("a rejection needs no data", () => {
    const result = renderEmailTemplate("application_rejected", {}, CONFIG)
    if (result.kind !== "rendered") throw new Error("expected a rendered email")
    expect(result.email.text).toContain("not able to open an account")
  })

  test("an unknown template key is reported, not guessed", () => {
    expect(renderEmailTemplate("statement_ready", {}, CONFIG)).toEqual({
      kind: "unrenderable",
      errorCode: "TEMPLATE_UNKNOWN",
    })
  })

  test("removed onboarding templates are unknown now", () => {
    for (const key of ["verify_email", "activation_invite"] as const) {
      expect(renderEmailTemplate(key, {}, CONFIG)).toEqual({
        kind: "unrenderable",
        errorCode: "TEMPLATE_UNKNOWN",
      })
    }
  })

  test("no template leaks the download link into the subject line", () => {
    const result = renderEmailTemplate("account_approved", { downloadUrl: APK_URL }, CONFIG)
    if (result.kind !== "rendered") throw new Error("expected a rendered email")
    expect(result.email.subject).not.toContain(APK_URL)
  })
})
