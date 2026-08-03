import { describe, expect, test } from "vitest"

import { renderEmailTemplate, type EmailTemplateConfig } from "./emailTemplates.js"

const CONFIG: EmailTemplateConfig = {
  landingOrigin: "https://beonedge.example",
  activationUrl: null,
  supportAddress: "support@beonedge.example",
}

const TOKEN = "aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789_-abcde"

describe("renderEmailTemplate", () => {
  test("verification carries a clickable link to the public page", () => {
    const result = renderEmailTemplate("verify_email", { verificationToken: TOKEN }, CONFIG)
    expect(result.kind).toBe("rendered")
    if (result.kind !== "rendered") return
    expect(result.email.subject).toContain("Confirm your email")
    expect(result.email.text).toContain(`https://beonedge.example/verify-email?token=${TOKEN}`)
    expect(result.email.text).toContain("support@beonedge.example")
  })

  test("verification falls back to printing the code when no site is configured", () => {
    const result = renderEmailTemplate(
      "verify_email",
      { verificationToken: TOKEN },
      { ...CONFIG, landingOrigin: null },
    )
    expect(result.kind).toBe("rendered")
    if (result.kind !== "rendered") return
    // The recipient must still be able to finish, so the token itself is shown.
    expect(result.email.text).toContain(TOKEN)
    expect(result.email.text).not.toContain("http")
  })

  test("a token needing escaping is url-encoded in the link", () => {
    const result = renderEmailTemplate("verify_email", { verificationToken: "a b+c" }, CONFIG)
    if (result.kind !== "rendered") throw new Error("expected a rendered email")
    expect(result.email.text).toContain("token=a%20b%2Bc")
  })

  test("the activation invite prints the code because the app has no deep link", () => {
    const result = renderEmailTemplate("activation_invite", { activationToken: TOKEN }, CONFIG)
    if (result.kind !== "rendered") throw new Error("expected a rendered email")
    expect(result.email.subject).toContain("approved")
    expect(result.email.text).toContain(TOKEN)
    expect(result.email.text).toContain("Activate account")
  })

  test("the activation invite adds a link when one is configured", () => {
    const result = renderEmailTemplate(
      "activation_invite",
      { activationToken: TOKEN },
      { ...CONFIG, activationUrl: "https://beonedge.example/activate?from=email" },
    )
    if (result.kind !== "rendered") throw new Error("expected a rendered email")
    // The existing query string is preserved, so the separator switches to `&`.
    expect(result.email.text).toContain(`https://beonedge.example/activate?from=email&token=${TOKEN}`)
  })

  test("a rejection needs no token", () => {
    const result = renderEmailTemplate("application_rejected", {}, CONFIG)
    if (result.kind !== "rendered") throw new Error("expected a rendered email")
    expect(result.email.text).toContain("not able to open an account")
  })

  test("a missing token is unrenderable rather than a broken email", () => {
    expect(renderEmailTemplate("verify_email", {}, CONFIG)).toEqual({
      kind: "unrenderable",
      errorCode: "TEMPLATE_DATA_MISSING",
    })
    expect(renderEmailTemplate("activation_invite", { activationToken: "" }, CONFIG)).toEqual({
      kind: "unrenderable",
      errorCode: "TEMPLATE_DATA_MISSING",
    })
  })

  test("an unknown template key is reported, not guessed", () => {
    expect(renderEmailTemplate("statement_ready", {}, CONFIG)).toEqual({
      kind: "unrenderable",
      errorCode: "TEMPLATE_UNKNOWN",
    })
  })

  test("no template leaks the raw token into the subject line", () => {
    for (const [key, data] of [
      ["verify_email", { verificationToken: TOKEN }],
      ["activation_invite", { activationToken: TOKEN }],
    ] as const) {
      const result = renderEmailTemplate(key, data, CONFIG)
      if (result.kind !== "rendered") throw new Error("expected a rendered email")
      expect(result.email.subject).not.toContain(TOKEN)
    }
  })
})
