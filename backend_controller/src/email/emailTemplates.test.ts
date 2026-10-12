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
    const result = renderEmailTemplate("account_approved", "v1", { downloadUrl: APK_URL }, CONFIG)
    expect(result.kind).toBe("rendered")
    if (result.kind !== "rendered") return
    expect(result.email.subject).toContain("approved")
    expect(result.email.text).toContain(APK_URL)
    expect(result.email.text).toContain("email address and password")
    expect(result.email.text).toContain("support@beonedge.example")
  })

  test("approval still renders without a download link", () => {
    const result = renderEmailTemplate("account_approved", "v1", {}, CONFIG)
    expect(result.kind).toBe("rendered")
    if (result.kind !== "rendered") return
    expect(result.email.text).not.toContain("http")
    expect(result.email.text).toContain("email address and password")
  })

  test("approval mentions the in-app verification step", () => {
    const result = renderEmailTemplate("account_approved", "v1", { downloadUrl: APK_URL }, CONFIG)
    if (result.kind !== "rendered") throw new Error("expected a rendered email")
    expect(result.email.text).toContain("verify your email address")
  })

  test("a rejection needs no data", () => {
    const result = renderEmailTemplate("application_rejected", "v1", {}, CONFIG)
    if (result.kind !== "rendered") throw new Error("expected a rendered email")
    expect(result.email.text).toContain("not able to open an account")
  })

  test("an unknown template key is reported, not guessed", () => {
    expect(renderEmailTemplate("statement_ready", "v1", {}, CONFIG)).toEqual({
      kind: "unrenderable",
      errorCode: "TEMPLATE_UNKNOWN",
    })
  })

  test("a version the key was never recorded with is refused instead of rendering the latest body", () => {
    for (const [key, version] of [
      ["account_approved", "v2"],
      ["application_rejected", "v0"],
      ["account_approved", ""],
    ] as const) {
      expect(renderEmailTemplate(key, version, { downloadUrl: APK_URL }, CONFIG)).toEqual({
        kind: "unrenderable",
        errorCode: "TEMPLATE_VERSION_UNSUPPORTED",
      })
    }
  })

  test("removed onboarding templates are unknown now", () => {
    for (const key of ["verify_email", "activation_invite"] as const) {
      expect(renderEmailTemplate(key, "v1", {}, CONFIG)).toEqual({
        kind: "unrenderable",
        errorCode: "TEMPLATE_UNKNOWN",
      })
    }
  })

  test("no template leaks the download link into the subject line", () => {
    const result = renderEmailTemplate("account_approved", "v1", { downloadUrl: APK_URL }, CONFIG)
    if (result.kind !== "rendered") throw new Error("expected a rendered email")
    expect(result.email.subject).not.toContain(APK_URL)
  })

  test("a queued approval whose download link is not http or https is not rendered", () => {
    for (const downloadUrl of ["javascript:alert(1)", "data:text/html,x", "/downloads/boe.apk"]) {
      expect(renderEmailTemplate("account_approved", "v1", { downloadUrl }, CONFIG)).toEqual({
        kind: "unrenderable",
        errorCode: "EMAIL_ACTION_URL_INVALID",
      })
    }
  })
})

describe("queued password mail", () => {
  const LINK = "https://app.beonedge.example/reset-password?token=SECRETTOKEN123"
  const queued = { link: LINK, validForMs: 600_000 }

  test("renders the set and reset links with their own wording and the sealed link in both bodies", () => {
    const set = renderEmailTemplate("password_set_link", "v1", queued, CONFIG)
    const reset = renderEmailTemplate("password_reset_link", "v1", queued, CONFIG)

    if (set.kind !== "rendered" || reset.kind !== "rendered") throw new Error("expected rendered emails")
    expect(set.email.subject).toBe(passwordInviteEmail({ link: LINK, validForMs: 600_000 }, CONFIG).subject)
    expect(reset.email.subject).toBe(passwordResetEmail({ link: LINK, validForMs: 600_000 }, CONFIG).subject)
    expect(set.email.subject).not.toBe(reset.email.subject)
    for (const rendered of [set, reset]) {
      expect(rendered.email.text).toContain(LINK)
      expect(rendered.email.html).toContain(LINK)
      expect(rendered.email.text).toContain("expires in 10 minutes")
      expect(rendered.email.subject).not.toContain("SECRETTOKEN123")
    }
  })

  test("renders the app download mail from the plain payload", () => {
    const result = renderEmailTemplate("password_app_download", "v1", { downloadUrl: APK_URL }, CONFIG)

    if (result.kind !== "rendered") throw new Error("expected a rendered email")
    expect(result.email.subject).toBe(appDownloadEmail(APK_URL, CONFIG).subject)
    expect(result.email.text).toContain(APK_URL)
  })

  test.each([
    ["password_set_link", { validForMs: 600_000 }],
    ["password_set_link", { link: LINK }],
    ["password_set_link", { link: LINK, validForMs: 0 }],
    ["password_set_link", { link: LINK, validForMs: "600000" }],
    ["password_reset_link", { link: "", validForMs: 600_000 }],
    ["password_app_download", {}],
  ] as const)("%s with unusable data is refused permanently and renders nothing", (templateKey, data) => {
    expect(renderEmailTemplate(templateKey, "v1", data, CONFIG)).toEqual({
      kind: "unrenderable",
      errorCode: "EMAIL_TEMPLATE_DATA_INVALID",
    })
  })

  test("a queued link whose address is not http or https is refused", () => {
    expect(
      renderEmailTemplate("password_reset_link", "v1", { link: "javascript:alert(1)", validForMs: 600_000 }, CONFIG),
    ).toEqual({ kind: "unrenderable", errorCode: "EMAIL_ACTION_URL_INVALID" })
  })

  test("a version the key was never recorded with is refused", () => {
    for (const key of ["password_set_link", "password_reset_link", "password_app_download"] as const) {
      expect(renderEmailTemplate(key, "v2", { ...queued, downloadUrl: APK_URL }, CONFIG)).toEqual({
        kind: "unrenderable",
        errorCode: "TEMPLATE_VERSION_UNSUPPORTED",
      })
    }
  })
})

describe("queued admin messages", () => {
  const message = { subject: "Hello Meera", body: "Hello Meera,\r\n\r\n<b>Line one</b>\nLine two\n\n\nThanks" }

  test("renders the approved words as escaped paragraphs inside the branded layout", () => {
    const result = renderEmailTemplate("admin_message", "v1", message, CONFIG)
    if (result.kind !== "rendered") throw new Error("expected a rendered email")
    expect(result.email.subject).toBe("Hello Meera")
    expect(result.email.html).toContain("&lt;b&gt;Line one&lt;/b&gt;<br>Line two")
    expect(result.email.html).not.toContain("<b>")
    expect(result.email.text).toContain("Hello Meera,\n\n<b>Line one</b>\nLine two\n\nThanks")
    expect(result.email.text).toContain("Regards,\nBeOnEdge Team")
  })

  test("marks a test in the subject and the first paragraph", () => {
    const result = renderEmailTemplate("admin_message", "v1", { ...message, test: true }, CONFIG)
    if (result.kind !== "rendered") throw new Error("expected a rendered email")
    expect(result.email.subject).toBe("[Test] Hello Meera")
    expect(result.email.text).toContain("It was not sent to a client")
  })

  test.each([
    ["a subject with a line break", { subject: "Hi\r\nBcc: x@example.com", body: "Body" }, "EMAIL_HEADER_INVALID"],
    ["a blank body", { subject: "Hi", body: "  \n\n " }, "EMAIL_TEMPLATE_DATA_INVALID"],
    ["a missing subject", { body: "Body" }, "EMAIL_TEMPLATE_DATA_INVALID"],
  ] as const)("refuses %s permanently", (_name, data, errorCode) => {
    expect(renderEmailTemplate("admin_message", "v1", data, CONFIG)).toEqual({ kind: "unrenderable", errorCode })
  })
})

describe("app update notices", () => {
  const notice = { version: "0.15.2", downloadUrl: "https://app.beonedge.in/downloads/client/boe.prod.client.0.15.2.apk?v=1502" }

  test("an optional update offers the official link and says the update is available", () => {
    const result = renderEmailTemplate("app_update_notice", "v1", { ...notice, mandatory: false }, CONFIG)
    if (result.kind !== "rendered") throw new Error("expected a rendered email")
    expect(result.email.subject).toBe("BeOnEdge app version 0.15.2 is available")
    expect(result.email.text).toContain(notice.downloadUrl)
    expect(result.email.text).not.toContain("required")
  })

  test("a required update says so in the subject and body, and carries the admin's note", () => {
    const result = renderEmailTemplate("app_update_notice", "v1", { ...notice, mandatory: true, message: "Statements load faster." }, CONFIG)
    if (result.kind !== "rendered") throw new Error("expected a rendered email")
    expect(result.email.subject).toBe("Update required: BeOnEdge app version 0.15.2")
    expect(result.email.text).toContain("is a required update")
    expect(result.email.text).toContain("Statements load faster.")
  })

  test.each([
    ["a link that is not https", { ...notice, downloadUrl: "javascript:alert(1)" }, "EMAIL_ACTION_URL_INVALID"],
    ["a version that is not a dotted number", { ...notice, version: "0.15.2\r\nBcc: x@example.com" }, "EMAIL_TEMPLATE_DATA_INVALID"],
  ] as const)("refuses %s permanently", (_name, data, errorCode) => {
    expect(renderEmailTemplate("app_update_notice", "v1", data, CONFIG)).toEqual({ kind: "unrenderable", errorCode })
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
    expect(expiry(3_600_000)).toContain("expires in 1 hour.")
    expect(expiry(86_400_000)).toContain("expires in 24 hours.")
    expect(expiry(5_400_000)).toContain("expires in 90 minutes.")
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
