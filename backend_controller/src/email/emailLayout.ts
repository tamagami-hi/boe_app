import { assertHeaderValue, escapeHtml, safeActionUrl, safeSupportAddress } from "./emailValidation.js"

export interface RenderedEmail {
  readonly subject: string
  readonly text: string
  readonly html: string
}

export type EmailBlock =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "action"; readonly label: string; readonly url: string }
  | { readonly kind: "code"; readonly lead: string; readonly code: string }

export interface EmailContent {
  readonly subject: string
  readonly preheader: string
  readonly heading: string
  readonly blocks: readonly EmailBlock[]
  readonly supportAddress: string | null
}

const COLOR = {
  page: "#f7f7f5",
  card: "#ffffff",
  border: "#e3e0d8",
  accent: "#b5894a",
  ink: "#0e1116",
  muted: "#5c6470",
  link: "#8a6428",
  button: "#0e1116",
  buttonText: "#faf9f6",
  codeBackground: "#f4f1e9",
  codeBorder: "#d9d2c0",
} as const

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const SERIF = "Georgia,'Times New Roman',serif"
const MONO = "ui-monospace,'SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace"

const row = (content: string, padding: string, extraStyle = ""): string =>
  `<tr><td style="padding:${padding};font-family:${SANS};font-size:16px;line-height:24px;color:${COLOR.ink};${extraStyle}">${content}</td></tr>`

const anchor = (href: string, label: string, extraStyle = ""): string =>
  `<a href="${escapeHtml(href)}" style="color:${COLOR.link};text-decoration:underline;${extraStyle}">${escapeHtml(label)}</a>`

const actionRows = (label: string, url: string): string =>
  [
    `<tr><td style="padding:8px 28px 20px 28px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${COLOR.button}" style="background-color:${COLOR.button};border-radius:6px;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:16px;line-height:20px;font-weight:700;color:${COLOR.buttonText};text-decoration:none;">${escapeHtml(label)}</a></td></tr></table></td></tr>`,
    row(
      `If the button does not work, copy and paste this link into your browser:<br>${anchor(url, url, "word-break:break-all;")}`,
      "0 28px 20px 28px",
      `font-size:14px;line-height:21px;color:${COLOR.muted};`,
    ),
  ].join("\n")

const codeRows = (lead: string, code: string): string =>
  [
    row(`${escapeHtml(lead)}:`, "0 28px 8px 28px"),
    `<tr><td style="padding:0 28px 20px 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${COLOR.codeBackground}" style="background-color:${COLOR.codeBackground};border:1px solid ${COLOR.codeBorder};border-radius:6px;padding:18px 12px;font-family:${MONO};font-size:32px;line-height:40px;font-weight:700;letter-spacing:4px;color:${COLOR.ink};-webkit-user-select:all;user-select:all;">${escapeHtml(code)}</td></tr></table></td></tr>`,
  ].join("\n")

const blockRows = (block: EmailBlock): string => {
  switch (block.kind) {
    case "text":
      return row(escapeHtml(block.text), "0 28px 16px 28px")
    case "action":
      return actionRows(block.label, block.url)
    case "code":
      return codeRows(block.lead, block.code)
  }
}

const supportRow = (address: string): string =>
  row(`Questions? Write to ${anchor(`mailto:${address}`, address)}.`, "0 28px 16px 28px")

const blockText = (block: EmailBlock): string => {
  switch (block.kind) {
    case "text":
      return block.text
    case "action":
      return `${block.label}:\n${block.url}`
    case "code":
      return `${block.lead} ${block.code}.`
  }
}

const resolveBlock = (block: EmailBlock): EmailBlock =>
  block.kind === "action" ? { ...block, url: safeActionUrl(block.url) } : block

const renderText = (
  heading: string,
  blocks: readonly EmailBlock[],
  supportAddress: string | null,
): string =>
  [
    heading,
    ...blocks.map(blockText),
    ...(supportAddress === null ? [] : [`Questions? Write to ${supportAddress}.`]),
    "Regards,\nBeOnEdge Team",
  ].join("\n\n")

const renderHtml = (
  content: EmailContent,
  subject: string,
  blocks: readonly EmailBlock[],
  supportAddress: string | null,
): string => {
  const rows = [
    `<tr><td style="padding:24px 28px 4px 28px;font-family:${SERIF};font-size:24px;line-height:30px;font-weight:700;color:${COLOR.ink};">BeOnEdge</td></tr>`,
    `<tr><td style="padding:8px 28px 16px 28px;font-family:${SANS};"><h1 style="margin:0;font-size:22px;line-height:28px;font-weight:700;color:${COLOR.ink};">${escapeHtml(content.heading)}</h1></td></tr>`,
    ...blocks.map(blockRows),
    ...(supportAddress === null ? [] : [supportRow(supportAddress)]),
    row("Regards,<br>BeOnEdge Team", "8px 28px 28px 28px"),
  ].join("\n")

  return [
    "<!DOCTYPE html>",
    '<html lang="en" dir="ltr">',
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(subject)}</title></head>`,
    `<body style="margin:0;padding:0;background-color:${COLOR.page};">`,
    `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;">${escapeHtml(content.preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.page}" style="background-color:${COLOR.page};"><tr><td align="center" style="padding:24px 12px;">`,
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background-color:${COLOR.card};border:1px solid ${COLOR.border};border-top:3px solid ${COLOR.accent};">`,
    rows,
    "</table>",
    "</td></tr></table>",
    "</body>",
    "</html>",
  ].join("\n")
}

export const renderEmail = (content: EmailContent): RenderedEmail => {
  const subject = assertHeaderValue(content.subject)
  const blocks = content.blocks.map(resolveBlock)
  const supportAddress = safeSupportAddress(content.supportAddress)
  return {
    subject,
    text: renderText(content.heading, blocks, supportAddress),
    html: renderHtml(content, subject, blocks, supportAddress),
  }
}
