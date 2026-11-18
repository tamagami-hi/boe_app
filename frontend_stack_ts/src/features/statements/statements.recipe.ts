export const STATEMENT_PRINT_ACTIONS = "flex flex-wrap gap-2 print:hidden"

export const STATEMENT_TABLE_SCROLL = "overflow-x-auto print:overflow-visible max-md:not-print:overflow-visible"

export const STATEMENT_TABLE = [
  "w-full min-w-[48rem] border-collapse",
  "font-ui text-sm text-fg",
  "print:min-w-0 print:text-xs",
  "max-md:not-print:block max-md:not-print:min-w-0",
].join(" ")

export const STATEMENT_CAPTION = "pb-3 text-left font-ui text-sm text-fg-muted max-md:not-print:block"

export const STATEMENT_HEAD = "max-md:not-print:sr-only"

export const STATEMENT_BODY = "max-md:not-print:block"

export const STATEMENT_HEAD_CELL = [
  "border-b border-hairline-strong px-3 py-2 text-left whitespace-nowrap",
  "font-ui text-2xs font-semibold uppercase tracking-eyebrow text-fg-muted",
].join(" ")

export const STATEMENT_HEAD_NUMERIC = [
  "border-b border-hairline-strong px-3 py-2 text-right whitespace-nowrap",
  "font-ui text-2xs font-semibold uppercase tracking-eyebrow text-fg-muted",
].join(" ")

export const STATEMENT_ROW = [
  "break-inside-avoid",
  "max-md:not-print:block max-md:not-print:border-b max-md:not-print:border-hairline-strong max-md:not-print:py-2",
].join(" ")

export const STATEMENT_MONTH_CELL = [
  "border-b border-hairline px-3 py-2 text-left align-top whitespace-nowrap",
  "font-ui text-sm font-semibold text-fg",
  "max-md:not-print:block max-md:not-print:border-0 max-md:not-print:px-0 max-md:not-print:py-1",
].join(" ")

export const STATEMENT_NUMERIC_CELL = [
  "border-b border-hairline px-3 py-2 text-right align-top",
  "max-md:not-print:flex max-md:not-print:items-baseline max-md:not-print:justify-between max-md:not-print:gap-4",
  "max-md:not-print:border-0 max-md:not-print:px-0 max-md:not-print:py-1",
  "max-md:not-print:before:content-[attr(data-label)] max-md:not-print:before:text-left max-md:not-print:before:text-fg-muted",
].join(" ")

export const STATEMENT_PREPARED = "m-0 font-ui text-sm text-fg-muted"

export const STATEMENT_NOTES = "m-0 flex list-disc flex-col gap-1 pl-5 font-ui text-sm text-fg-muted"
