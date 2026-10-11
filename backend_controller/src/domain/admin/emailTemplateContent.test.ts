import { describe, expect, test } from "vitest"

import { fillPlaceholders, slugFromName, templateContentProblems } from "./emailTemplateContent.js"

describe("template content rules", () => {
  test("accepts plain text with the allowed placeholders, spaced or not", () => {
    expect(templateContentProblems("Hello {{first_name}}", "Dear {{ full_name }},\n\nThanks.")).toEqual({})
  })

  test.each([
    ["a line break in the subject", "Hello\r\nBcc: victim@example.com", "Body"],
    ["a bare newline in the subject", "Hello\nthere", "Body"],
    ["an empty subject", "   ", "Body"],
    ["an over-long subject", "x".repeat(151), "Body"],
  ])("refuses %s", (_name, subject, body) => {
    expect(templateContentProblems(subject, body).subject).toBeDefined()
  })

  test.each([
    ["an empty body", "Subject", "  \n "],
    ["an over-long body", "Subject", "x".repeat(5001)],
    ["an unknown placeholder", "Subject", "Your code is {{otp_code}}"],
    ["a password link placeholder", "Subject", "Reset at {{reset_link}}"],
    ["an unclosed placeholder", "Subject", "Hello {{first_name"],
    ["a stray closing brace pair", "Subject", "Hello first_name}}"],
  ])("refuses %s in the body", (_name, subject, body) => {
    expect(templateContentProblems(subject, body).body).toBeDefined()
  })

  test("refuses an unknown placeholder in the subject too", () => {
    expect(templateContentProblems("Hi {{email}}", "Body").subject).toBeDefined()
  })
})

describe("filling placeholders", () => {
  test("replaces every allowed placeholder and leaves the rest of the text exactly as written", () => {
    expect(
      fillPlaceholders("Dear {{full_name}}, hello {{ first_name }}. <b>not html</b> & {{first_name}}", {
        first_name: "Asha",
        full_name: "Asha Verma",
      }),
    ).toBe("Dear Asha Verma, hello Asha. <b>not html</b> & Asha")
  })
})

describe("slugs from names", () => {
  test.each([
    ["Welcome note", "welcome-note"],
    ["  Diwali   greetings 2026!! ", "diwali-greetings-2026"],
    ["Ünïcode only ✓", "n-code-only"],
  ])("turns %j into %j", (name, slug) => {
    expect(slugFromName(name)).toBe(slug)
  })

  test("falls back to a fixed prefix when nothing usable is left", () => {
    expect(slugFromName("✓✓✓")).toBe("template")
  })
})
