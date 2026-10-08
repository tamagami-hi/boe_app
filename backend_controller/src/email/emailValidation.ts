export type EmailValidationCode = "EMAIL_HEADER_INVALID" | "EMAIL_ACTION_URL_INVALID"

export class EmailValidationError extends Error {
  readonly code: EmailValidationCode

  constructor(code: EmailValidationCode) {
    super(code)
    this.name = "EmailValidationError"
    this.code = code
  }
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

const SUPPORT_ADDRESS = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u
const LINE_BREAK = /[\r\n]/u
const UNSAFE_URL_CHARACTER = /[\s\u0000-\u001f\u007f-\u009f]/u

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/gu, (character) => HTML_ESCAPES[character] ?? character)

export const assertHeaderValue = (value: string): string => {
  if (LINE_BREAK.test(value)) throw new EmailValidationError("EMAIL_HEADER_INVALID")
  return value
}

export const safeActionUrl = (value: string): string => {
  if (UNSAFE_URL_CHARACTER.test(value)) throw new EmailValidationError("EMAIL_ACTION_URL_INVALID")
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new EmailValidationError("EMAIL_ACTION_URL_INVALID")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new EmailValidationError("EMAIL_ACTION_URL_INVALID")
  }
  return parsed.href
}

export const safeSupportAddress = (value: string | null): string | null =>
  typeof value === "string" && SUPPORT_ADDRESS.test(value) ? value : null
