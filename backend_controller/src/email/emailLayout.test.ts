import { describe, expect, test } from "vitest"

import { renderEmail, type EmailContent } from "./emailLayout.js"

const HOSTILE = `<script>alert("x")</script>`
const HOSTILE_ESCAPED = "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"

const content = (overrides: Partial<EmailContent> = {}): EmailContent => ({
  subject: "Subject line",
  preheader: "Preview line",
  heading: "Heading line",
  blocks: [{ kind: "text", text: "Body line" }],
  supportAddress: null,
  ...overrides,
})

const failureOf = (build: () => unknown): unknown => {
  try {
    build()
    return null
  } catch (error) {
    return error
  }
}

const withAction = (url: string): EmailContent =>
  content({ blocks: [{ kind: "action", label: "Open", url }] })

describe("renderEmail HTML escaping", () => {
  test("escapes every dynamic value placed in HTML text", () => {
    const { html } = renderEmail(
      content({
        subject: HOSTILE,
        preheader: HOSTILE,
        heading: HOSTILE,
        blocks: [
          { kind: "text", text: HOSTILE },
          { kind: "action", label: HOSTILE, url: "https://example.com/path" },
          { kind: "code", lead: HOSTILE, code: HOSTILE },
        ],
      }),
    )

    expect(html).not.toContain("<script")
    expect(html.split(HOSTILE_ESCAPED)).toHaveLength(8)
  })

  test("escapes action URLs placed in attributes and link text", () => {
    const { html, text } = renderEmail(withAction("https://example.com/o'brien?a=1&b=2"))

    expect(html).not.toContain("a=1&b=2")
    expect(html.split("https://example.com/o&#39;brien?a=1&amp;b=2")).toHaveLength(4)
    expect(text).toContain("https://example.com/o'brien?a=1&b=2")
  })

  test("a quote in a URL cannot close the href attribute", () => {
    const { html } = renderEmail(withAction('https://example.com/"onmouseover="alert(1)'))

    expect(html).not.toContain('"onmouseover')
    expect(html).toContain('href="https://example.com/%22onmouseover=%22alert(1)"')
  })

  test("a hostile support address is dropped instead of rendered", () => {
    const { html, text } = renderEmail(
      content({ supportAddress: 'help@example.com"><script>alert(1)</script>' }),
    )

    expect(html).not.toContain("<script")
    expect(html).not.toContain("mailto:")
    expect(text).not.toContain("Questions?")
  })

  test("a valid support address is offered as text and as a mail link", () => {
    const { html, text } = renderEmail(content({ supportAddress: "help@example.com" }))

    expect(text).toContain("Questions? Write to help@example.com.")
    expect(html).toContain('href="mailto:help@example.com"')
  })
})

describe("renderEmail action URL validation", () => {
  test.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.com/file",
    "mailto:someone@example.com",
    "//example.com/path",
    "/reset-password?token=abc",
    "",
    "https://example.com/a b",
    "https://example.com/\r\nBcc: attacker@example.com",
  ])("rejects %j", (url) => {
    expect(failureOf(() => renderEmail(withAction(url)))).toMatchObject({
      name: "EmailValidationError",
      code: "EMAIL_ACTION_URL_INVALID",
    })
  })

  test.each([
    "http://localhost:5173/reset-password?token=abc",
    "https://app.beonedge.in/downloads/client/boe.prod.client.1.0.0.apk?v=12",
  ])("accepts %j and keeps it intact in both bodies", (url) => {
    const { html, text } = renderEmail(withAction(url))

    expect(text).toContain(url)
    expect(html).toContain(`href="${url}"`)
  })
})

describe("renderEmail header validation", () => {
  test.each(["Hello\r\nBcc: attacker@example.com", "Hello\nBcc: attacker@example.com", "Hello\rBcc: a@b.co"])(
    "rejects a subject carrying a line break: %j",
    (subject) => {
      expect(failureOf(() => renderEmail(content({ subject })))).toMatchObject({
        name: "EmailValidationError",
        code: "EMAIL_HEADER_INVALID",
      })
    },
  )

  test("returns a clean subject unchanged", () => {
    expect(renderEmail(content({ subject: "Reset your BeOnEdge password" })).subject).toBe(
      "Reset your BeOnEdge password",
    )
  })
})
