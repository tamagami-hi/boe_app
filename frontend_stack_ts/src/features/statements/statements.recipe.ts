export const STATEMENT_PRINT_ACTIONS = "flex flex-wrap gap-2 print:hidden"

export const STATEMENT_TABLE_SCROLL = "overflow-x-auto print:overflow-visible"

export const STATEMENT_TABLE = [
  "w-full min-w-[48rem] border-collapse",
  "font-ui text-sm text-fg",
  "print:min-w-0 print:text-xs",
].join(" ")

export const STATEMENT_CAPTION = "pb-3 text-left font-ui text-sm text-fg-muted"

export const STATEMENT_HEAD_CELL = [
  "border-b border-hairline-strong px-3 py-2 text-left whitespace-nowrap",
  "font-ui text-2xs font-semibold uppercase tracking-eyebrow text-fg-muted",
].join(" ")

export const STATEMENT_HEAD_NUMERIC = [
  "border-b border-hairline-strong px-3 py-2 text-right whitespace-nowrap",
  "font-ui text-2xs font-semibold uppercase tracking-eyebrow text-fg-muted",
].join(" ")

export const STATEMENT_ROW = "break-inside-avoid"

export const STATEMENT_MONTH_CELL = [
  "border-b border-hairline px-3 py-2 text-left align-top whitespace-nowrap",
  "font-ui text-sm font-semibold text-fg",
].join(" ")

export const STATEMENT_NUMERIC_CELL = "border-b border-hairline px-3 py-2 text-right align-top"

export const STATEMENT_PREPARED = "m-0 font-ui text-sm text-fg-muted"
