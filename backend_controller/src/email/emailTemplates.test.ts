import { describe, expect, test } from "vitest"

import {
  appDownloadEmail,
  emailVerificationCodeEmail,
  passwordInviteEmail,
  passwordResetEmail,
  renderEmailTemplate,
  type EmailTemplateConfig,
} from "./emailTemplates.js"

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

  test("a queued approval whose download link is not http or https is not rendered", () => {
    for (const downloadUrl of ["javascript:alert(1)", "data:text/html,x", "/downloads/boe.apk"]) {
      expect(renderEmailTemplate("account_approved", { downloadUrl }, CONFIG)).toEqual({
        kind: "unrenderable",
        errorCode: "EMAIL_ACTION_URL_INVALID",
      })
    }
  })
})

describe("emailVerificationCodeEmail", () => {
  const CODE = "aB3dE9"

  test("keeps the code, case sensitivity, expiry and warnings of the original message", () => {
    const email = emailVerificationCodeEmail({ code: CODE, validForMs: 600_000 }, CONFIG)

    expect(/code is ([A-Za-z0-9]{6})\b/u.exec(email.text)?.[1]).toBe(CODE)
    expect(email.text).toContain(`Your BeOnEdge email verification code is ${CODE}.`)
    expect(email.text).toContain("6-character")
    expect(email.text).toContain("case-sensitive")
    expect(email.text).toContain("expires in 10 minutes")
    expect(email.text).toContain("Do not share this code with anyone")
    expect(email.text).toContain("If you did not request this code, ignore this email")
    expect(email.html).toContain(`>${CODE}</td>`)
  })

  test("never puts the code in the subject", () => {
    expect(emailVerificationCodeEmail({ code: CODE, validForMs: 600_000 }, CONFIG).subject).not.toContain(CODE)
  })

  test("states the configured expiry instead of a fixed number", () => {
    const expiry = (validForMs: number): string =>
      emailVerificationCodeEmail({ code: CODE, validForMs }, CONFIG).text

    expect(expiry(300_000)).toContain("expires in 5 minutes.")
    expect(expiry(60_000)).toContain("expires in 1 minute.")
    expect(expiry(90_000)).toContain("expires in 90 seconds.")
  })
})

describe("password and download emails", () => {
  const LINK = "https://app.beonedge.example/reset-password?token=SECRETTOKEN123"

  test("carry the link in both bodies and never in the subject", () => {
    const emails = [
      passwordInviteEmail({ link: LINK, validForMs: 600_000 }, CONFIG),
      passwordResetEmail({ link: LINK, validForMs: 600_000 }, CONFIG),
      appDownloadEmail(LINK, CONFIG),
    ]

    for (const email of emails) {
      expect(email.text).toContain(LINK)
      expect(email.html).toContain(LINK)
      expect(email.subject).not.toMatch(/SECRETTOKEN123|https?:/u)
    }
  })

  test("a link that is not http or https is refused", () => {
    expect(() => passwordResetEmail({ link: "javascript:alert(1)", validForMs: 600_000 }, CONFIG)).toThrow()
    expect(() => appDownloadEmail("data:text/html,x", CONFIG)).toThrow()
  })

})
