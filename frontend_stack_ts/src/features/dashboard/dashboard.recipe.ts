import { GRID_BASE } from "~/ui/recipes/layout"
import { CARD_LINK } from "~/ui/recipes/surface"

export const BENTO = `${GRID_BASE} md:grid-cols-6 lg:gap-5`

export const FUND_CARD_LINK = `${CARD_LINK} h-full`

export const SPAN_HERO = "md:col-span-6 lg:col-span-4"

export const SPAN_ASIDE = "md:col-span-3 lg:col-span-2"

export const SPAN_THIRD = "md:col-span-2"

export const HEADLINE_ROW = "flex flex-wrap items-end justify-between gap-4"

export const HEADLINE_CELL = "flex flex-col gap-2"

export const RETURN_CELL = "flex flex-col items-start gap-1 lg:items-end lg:text-right"

export const SPLIT = "mt-4 grid grid-cols-2 gap-4 border-t border-hairline pt-4"

export const STATUS_ROW = [
  "flex items-center justify-between gap-3 py-2",
  "border-t border-hairline first-of-type:border-t-0",
].join(" ")

export const FUND_ROW = "flex items-baseline justify-between gap-3"

export const GATE_ROW = "flex flex-wrap items-center gap-4"
