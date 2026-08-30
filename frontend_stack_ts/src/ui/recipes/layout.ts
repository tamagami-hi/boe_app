export type PageWidth = "default" | "wide" | "form"

export const PAGE_BASE = [
  "relative mx-auto flex w-full flex-col",
  "px-[max(var(--be-page-pad-x),var(--be-safe-left))]",
  "md:px-[max(var(--be-page-pad-x-md),var(--be-safe-left))]",
  "lg:px-[max(var(--be-page-pad-x-lg),var(--be-safe-left))]",
  "pt-8 md:pt-10 lg:pt-16",
  "pb-[calc(var(--be-nav-h)+var(--be-safe-bottom)+var(--be-space-9))] lg:pb-16",
  "gap-8 md:gap-10 lg:gap-12",
].join(" ")

export const PAGE_WIDTH: Readonly<Record<PageWidth, string>> = {
  default: "max-w-content",
  wide: "max-w-wide",
  form: "max-w-form",
}

export const SECTION_ROOT = "flex flex-col gap-4"

export const SECTION_HEAD = "flex flex-col gap-1"

export const SECTION_HEAD_ROW = "flex items-baseline justify-between gap-3"

export const SECTION_HEAD_TITLE = "font-ui text-lg font-semibold leading-snug text-fg"

export const SECTION_HEAD_DESC =
  "max-w-[62ch] font-ui text-sm leading-normal text-fg-muted"

export const SECTION_BODY = "flex flex-col gap-4"

export const GRID_BASE = "grid grid-cols-1 gap-4"

export const GRID_COLS: Readonly<Record<2 | 3 | 4, string>> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
}

export const CARD_COLUMNS: Readonly<Record<2 | 3, string>> = {
  2: "lg:grid lg:grid-cols-2 lg:items-start lg:gap-4",
  3: "lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 xl:grid-cols-3",
}

export const CARD_COLUMNS_WRAP: Readonly<Record<2 | 3, string>> = {
  2: `contents ${CARD_COLUMNS[2]}`,
  3: `contents ${CARD_COLUMNS[3]}`,
}

export const FEED_MEASURE = "lg:max-w-[68rem]"

export const FIELD_MEASURE = "lg:max-w-[38rem]"

export const PAGE_HEADER_ROOT = "flex flex-col gap-3 lg:gap-4"

export const PAGE_HEADER_ROW = [
  "flex flex-col items-start gap-4",
  "sm:flex-row sm:items-end sm:justify-between",
].join(" ")

export const PAGE_HEADER_TITLE = [
  "m-0 font-display font-light text-page lg:text-page-lg text-fg",
  "[text-wrap:balance]",
].join(" ")

export const PAGE_HEADER_DESC =
  "m-0 max-w-[58ch] font-ui text-base lg:text-md leading-relaxed text-fg-muted"

export const PAGE_HEADER_ACTIONS = "flex flex-wrap gap-2"

export const STACK_SM = "flex flex-col gap-2"

export const STACK_LG = "flex flex-col gap-4"

export const ROW_BETWEEN = "flex items-start justify-between gap-3"

export const ROW_BETWEEN_BASELINE = "flex items-baseline justify-between gap-3"

export const GRID_COLS_MD: Readonly<Record<2 | 3 | 4, string>> = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-2 lg:grid-cols-3",
  4: "md:grid-cols-2 lg:grid-cols-4",
}

export const PAGE_HEADER_RULE =
  "h-px w-11 bg-gradient-to-r from-gold to-transparent"

export const ACTION_ROW = "flex flex-wrap gap-2"

export const BOTTOM_NAV = [
  "sticky bottom-0 z-nav grid grid-flow-col auto-cols-fr lg:hidden",
  "bg-nav-bg backdrop-blur-[22px] backdrop-saturate-[1.6]",
  "shadow-[0_-1px_0_var(--be-nav-hairline),0_-18px_40px_-28px_rgb(var(--be-tint-warm)/34%)]",
  "pb-safe-bottom pl-safe-left pr-safe-right",
].join(" ")

export const APP_SHELL = "relative flex min-h-dvh flex-col bg-bg"
