export const LIST_ROOT = "m-0 flex list-none flex-col p-0"

export const LIST_ROW = [
  "flex items-baseline justify-between gap-4 py-3",
  "border-b border-hairline last:border-b-0",
  "lg:grid lg:max-w-[44rem] lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-6",
].join(" ")

export const LIST_LABEL = "min-w-0 shrink font-ui text-sm text-fg-muted"

export const LIST_VALUE =
  "min-w-0 text-right font-ui text-sm font-semibold text-fg [overflow-wrap:anywhere] lg:text-left"

export const LIST_VALUE_LEAD =
  "min-w-0 text-right font-ui text-md font-semibold text-fg [overflow-wrap:anywhere] lg:text-left"

export const LIST_SPLIT = "lg:grid lg:grid-cols-2 lg:gap-x-12"

export const STAT_ROOT = "flex flex-col gap-1"

export const SUMMARY_GRID = [
  "grid grid-cols-2 gap-3 md:grid-cols-4",
  "border-t border-hairline pt-3",
].join(" ")

export const STAT_LABEL =
  "font-ui text-2xs font-semibold uppercase tracking-eyebrow text-fg-faint"

export const PROSE_BODY =
  "m-0 max-w-[68ch] whitespace-pre-wrap font-ui text-base leading-relaxed text-fg-muted"

export const DISCLOSURE_ROOT = "flex flex-col border-b border-hairline"

export const DISCLOSURE_BUTTON = [
  "flex w-full min-h-target items-center justify-between gap-3 py-3",
  "cursor-pointer border-0 bg-transparent text-left",
  "font-ui text-base font-semibold text-fg",
].join(" ")

export const DISCLOSURE_GLYPH = [
  "size-icon-sm flex-none text-fg-faint",
  "transition-transform duration-200 ease-out",
].join(" ")

export const DISCLOSURE_GLYPH_OPEN = "rotate-45"

export const DISCLOSURE_PANEL = "pb-4"

export const ITEM_TITLE = "font-ui text-md font-semibold text-fg"

export const PROSE_SM = "m-0 max-w-[64ch] font-ui text-sm leading-normal text-fg-muted"

export const PROSE_PRE = "whitespace-pre-wrap"

export const NAV_LIST = "m-0 flex list-none flex-col p-0 lg:max-w-[44rem]"

export const NAV_ROW = [
  "flex min-h-target items-center justify-between gap-4 py-3",
  "border-b border-hairline last:border-b-0",
  "text-inherit no-underline",
  "transition-colors duration-200 ease-out hover:text-fg",
].join(" ")

export const ENTRY_TEXT = "flex flex-col gap-0.5"

export const ENTRY_GLYPH = "size-icon-sm flex-none text-fg-faint"
