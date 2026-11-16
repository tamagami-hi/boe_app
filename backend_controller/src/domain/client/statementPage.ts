import { createHash } from "node:crypto"

import { groupIndian } from "../../email/emailMoney.js"
import { escapeHtml } from "../../email/emailValidation.js"
import type { StatementDocument, StatementEarlyExit } from "./statementLinks.js"
import type { StatementPeriod } from "./statements.js"

const LOCALE = "en-IN"
const TIME_ZONE = "Asia/Kolkata"
const PAISE_PER_RUPEE = 100n
const HALF_RUPEE = 50n
const MARKET_RISK = "Investments are subject to market risk."
const SOURCE = "Values recorded by BeOnEdge"
const SEPARATOR = " · "

const STYLE = [
  ":root{color-scheme:light;--fg:#1d1d1b;--muted:#5c5c57;--line:#dcdcd6;--strong:#b9b9b1;--pos:#1d6b3a;--neg:#a5281b}",
  "*{box-sizing:border-box}",
  "body{margin:0;background:#fff;color:var(--fg);font:15px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}",
  "main{max-width:64rem;margin:0 auto;padding:24px 16px 32px}",
  ".eyebrow{margin:0;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}",
  "h1{margin:4px 0 8px;font-size:26px;line-height:1.2}",
  ".meta{margin:0 0 4px;font-size:14px;color:var(--muted)}",
  ".scroll{margin-top:16px;overflow-x:auto}",
  "table{width:100%;min-width:48rem;border-collapse:collapse;font-size:14px}",
  "caption{padding-bottom:12px;text-align:left;font-size:14px;color:var(--muted)}",
  "th,td{padding:8px 12px;border-bottom:1px solid var(--line);white-space:nowrap;vertical-align:top}",
  "thead th{border-bottom-color:var(--strong);font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}",
  "th{text-align:left}",
  ".num{text-align:right;font-variant-numeric:tabular-nums}",
  ".pos{color:var(--pos)}",
  ".neg{color:var(--neg)}",
  "tbody tr{break-inside:avoid}",
  ".note{margin-top:16px;font-size:13px;color:var(--muted)}",
  "@page{margin:12mm}",
  "@media print{main{padding:0;max-width:none}.scroll{overflow:visible}table{min-width:0;font-size:11px}}",
].join("")

export const STATEMENT_PAGE_CSP = [
  "default-src 'none'",
  `style-src 'sha256-${createHash("sha256").update(STYLE).digest("base64")}'`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ")

const dateFormatter = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, day: "2-digit", month: "short", year: "numeric" })
const monthFormatter = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, month: "short", year: "numeric" })

const formatMonth = (period: string): string => monthFormatter.format(new Date(`${period}-01T00:00:00Z`))

const formatCalendarDate = (date: string): string => dateFormatter.format(new Date(`${date}T00:00:00Z`))

const formatStatementRupees = (paise: bigint, showSign: boolean): string => {
  const magnitude = paise < 0n ? -paise : paise
  const amount = `₹${groupIndian(((magnitude + HALF_RUPEE) / PAISE_PER_RUPEE).toString())}`
  if (paise < 0n) return `-${amount}`
  return showSign && paise > 0n ? `+${amount}` : amount
}

type Column = Readonly<{ label: string; value: (period: StatementPeriod) => bigint; signed: boolean }>

const COLUMNS: readonly Column[] = [
  { label: "Opening", value: (period) => period.openingValuePaise, signed: false },
  { label: "Contributions", value: (period) => period.contributionsPaise, signed: false },
  { label: "Growth", value: (period) => period.growthPaise, signed: true },
  { label: "Corrections", value: (period) => period.reversalsPaise, signed: true },
  { label: "Withdrawals", value: (period) => period.withdrawalsPaise, signed: true },
  { label: "Closing", value: (period) => period.closingValuePaise, signed: false },
  { label: "Invested to date", value: (period) => period.totalInvestmentPaise, signed: false },
]

const moneyCell = (column: Column, period: StatementPeriod): string => {
  const paise = column.value(period)
  const tone = column.signed ? (paise < 0n ? " neg" : " pos") : ""
  return `<td class="num${tone}">${escapeHtml(formatStatementRupees(paise, column.signed))}</td>`
}

const row = (period: StatementPeriod): string =>
  `<tr><th scope="row">${escapeHtml(formatMonth(period.period))}</th>${COLUMNS.map((column) => moneyCell(column, period)).join("")}</tr>`

const table = (periods: readonly StatementPeriod[]): string =>
  periods.length === 0
    ? `<p class="meta">No statements yet. Your first statement appears once you have invested.</p>`
    : [
        `<div class="scroll" tabindex="0" role="region" aria-label="Statement table"><table><caption>Month-by-month value of your investments</caption>`,
        `<thead><tr><th scope="col">Month</th>${COLUMNS.map((column) => `<th scope="col" class="num">${column.label}</th>`).join("")}</tr></thead>`,
        `<tbody>${periods.map(row).join("")}</tbody></table></div>`,
      ].join("")

const earlyExitLine = (exit: StatementEarlyExit): string =>
  `<li>${escapeHtml(`Early exit: your SIP in ${exit.fundName} was closed early on ${formatCalendarDate(exit.effectiveDate)}, and its full value, ${formatStatementRupees(exit.amountPaise, false)}, was withdrawn. It is counted under Withdrawals.`)}</li>`

const earlyExitNotes = (exits: readonly StatementEarlyExit[]): string =>
  exits.length === 0 ? "" : `<ul class="note">${exits.map(earlyExitLine).join("")}</ul>`

const footnote = (lastUpdated: string | null): string => {
  const freshness = lastUpdated === null ? [] : [`Last updated ${formatCalendarDate(lastUpdated)}`]
  return `<p class="note">${escapeHtml([SOURCE, ...freshness, MARKET_RISK].join(SEPARATOR))}</p>`
}

const page = (title: string, body: string): string =>
  [
    `<!doctype html><html lang="en-IN"><head><meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">`,
    `<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>`,
    `<body><main>${body}</main></body></html>`,
  ].join("")

export const renderStatementPage = (document: StatementDocument): string => {
  const prepared = dateFormatter.format(document.preparedAt)
  const covering =
    document.fromPeriod === document.toPeriod
      ? formatMonth(document.fromPeriod)
      : `${formatMonth(document.fromPeriod)} to ${formatMonth(document.toPeriod)}`
  return page(
    "BeOnEdge investment statement",
    [
      `<p class="eyebrow">BeOnEdge</p><h1>Investment statement</h1>`,
      `<p class="meta">${escapeHtml(`Prepared for ${document.holderName} on ${prepared}`)}</p>`,
      `<p class="meta">${escapeHtml(`Covering ${covering}`)}</p>`,
      table(document.periods),
      earlyExitNotes(document.earlyExits),
      footnote(document.lastUpdated),
    ].join(""),
  )
}

export const renderUnavailablePage = (): string =>
  page(
    "BeOnEdge statement link",
    [
      `<p class="eyebrow">BeOnEdge</p><h1>This statement link is not available</h1>`,
      `<p class="meta">A statement link opens once and expires after a short time. Open Statements in the BeOnEdge app to get a new link.</p>`,
    ].join(""),
  )

export const renderFailurePage = (): string =>
  page(
    "BeOnEdge statement link",
    [
      `<p class="eyebrow">BeOnEdge</p><h1>The statement could not be loaded</h1>`,
      `<p class="meta">Reload this page to try again. If the link no longer opens, open Statements in the BeOnEdge app to get a new link.</p>`,
    ].join(""),
  )
