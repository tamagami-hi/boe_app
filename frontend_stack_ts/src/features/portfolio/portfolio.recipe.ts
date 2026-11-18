export const POOL_TOP = "flex items-baseline justify-between gap-3"

export const POOL_META = "grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1"

export const VIEW_CONTROLS = "flex flex-nowrap items-center justify-between gap-2"

export const VIEW_TABS = [
  "flex min-w-0 flex-none",
  "[&_[role=tab]]:px-3 [&_[role=tab]]:text-xs lg:[&_[role=tab]]:min-h-target",
].join(" ")

export const VIEW_LINKS = "flex flex-none items-center"

export const VIEW_LINK = [
  "inline-flex min-h-target items-center px-2 rounded-full",
  "font-ui text-sm font-semibold whitespace-nowrap text-fg-muted no-underline",
  "transition-colors duration-200 ease-out hover:text-fg",
].join(" ")

export const VIEW_LINK_SHORT = "min-[400px]:hidden"

export const VIEW_LINK_FULL = "hidden min-[400px]:inline"

export const BREAKDOWN_FUND = "flex flex-col gap-3"

export const BREAKDOWN_BLOCK = "flex flex-col gap-2 border-t border-hairline pt-3"

export const BREAKDOWN_BLOCK_TITLE = "m-0 flex flex-wrap items-center gap-2 font-ui text-sm font-semibold text-fg"

export const BREAKDOWN_FUND_TITLE = "m-0"

export const BREAKDOWN_META = "m-0 grid grid-cols-[10rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1"
