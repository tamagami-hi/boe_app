export const FUND_CONTROLS = [
  "flex flex-col gap-3",
  "sm:flex-row sm:items-center sm:justify-between",
].join(" ")

export const FUND_SORT_GROUP = "flex gap-2"

export const FUND_SORT_BUTTON = [
  "min-h-target lg:min-h-target-compact px-3",
  "cursor-pointer rounded-full border border-rule-strong bg-transparent",
  "font-ui text-sm font-semibold text-fg-muted",
  "transition-colors duration-200 ease-out",
  "aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-fg-inverse",
].join(" ")

export const FUND_CARD_TOP = "flex items-start justify-between gap-2"

export const FUND_SIZE_ROW = "flex flex-col gap-0.5"

export const FUND_DETAIL_LIST = "flex flex-col gap-2"

export const FUND_DETAIL_ROW = [
  "flex items-baseline justify-between gap-3 py-2",
  "border-b border-rule",
].join(" ")

export const FUND_DISCLOSURE_BODY = [
  "m-0 max-w-[68ch] whitespace-pre-wrap",
  "font-ui text-sm leading-relaxed text-fg-muted",
].join(" ")

export const FUND_ACTIONS = "flex flex-col gap-2 sm:flex-row"

export const FUND_TABLE_INNER = [
  "overflow-hidden bg-parchment inset-shadow-lift-soft shadow-ambient-1",
  "rounded-[calc(var(--be-squircle-lg)-var(--be-shell-pad))]",
  "lg:rounded-[calc(var(--be-squircle-xl)-var(--be-shell-pad-lg))]",
].join(" ")

export const FUND_TABLE = "w-full border-collapse"

export const FUND_TABLE_HEAD_CELL = [
  "border-b border-hairline bg-sand/32",
  "px-4 py-3 text-left",
].join(" ")

export const FUND_TABLE_HEAD_LABEL =
  "font-ui text-2xs font-semibold uppercase tracking-[0.16em] text-fg-muted"

export const FUND_TABLE_HEAD_BUTTON = [
  "inline-flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0",
  FUND_TABLE_HEAD_LABEL,
  "transition-colors duration-200 ease-out aria-pressed:text-fg",
].join(" ")

export const FUND_TABLE_ROW = [
  "group transition-colors duration-200 ease-out",
  "hover:bg-sand/22",
].join(" ")

export const FUND_TABLE_CELL = [
  "border-b border-hairline p-4 align-middle",
  "group-last:border-b-0",
].join(" ")

export const FUND_TABLE_NAME_LINK = "flex flex-col gap-0.5 text-inherit no-underline"

export const FUND_TABLE_NAME = "font-ui text-base font-semibold text-fg"

export const FUND_TABLE_MUTED = "font-ui text-sm text-fg-faint"

export const FUND_SORT_GLYPH = "size-[9px]"
