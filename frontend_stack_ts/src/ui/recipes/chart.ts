export const DONUT_WRAP =
  "flex flex-col items-stretch gap-4 md:flex-row md:items-center md:gap-6"

export const DONUT_FIGURE = [
  "relative mx-auto aspect-square w-full max-w-60",
  "md:mx-0 md:w-44 md:max-w-none md:flex-none",
].join(" ")

export const DONUT_SVG = "block size-full overflow-visible"

export const DONUT_ARC = "transition-opacity duration-200 ease-out"

export const DONUT_CENTRE = "absolute inset-[22%] grid place-items-center text-center"

export const DONUT_CENTRE_VALUE =
  "money text-xl font-semibold tracking-display text-fg"

export const LEGEND_ROOT = "m-0 flex min-w-0 list-none flex-col p-0 md:flex-1"

export const LEGEND_ROW = [
  "flex items-baseline gap-3 py-2",
  "border-b border-hairline last:border-b-0",
].join(" ")

export const LEGEND_SWATCH = "size-2.5 flex-none rounded-[3px]"

export const LEGEND_LABEL =
  "min-w-0 flex-1 font-ui text-sm text-fg [overflow-wrap:anywhere]"

export const LEGEND_VALUE = "flex-none money text-sm font-semibold text-fg-muted"
