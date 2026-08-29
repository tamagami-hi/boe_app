const PIN_KEY_BASE = [
  "min-h-14 cursor-pointer rounded-squircle border-0 bg-parchment text-fg",
  "ring-inset-hairline-strong font-semibold",
  "transition-[transform,background-color] duration-[var(--be-dur-fast)] ease-out",
  "active:scale-[0.96] active:bg-sand",
].join(" ")

export const PIN_PAD = "mx-auto grid max-w-80 grid-cols-3 gap-3"

export const PIN_KEY = `${PIN_KEY_BASE} font-numeric text-xl [font-variant-numeric:tabular-nums]`

export const PIN_KEY_WIDE = `${PIN_KEY_BASE} font-ui text-sm`

export const PIN_DOTS = "flex justify-center gap-3 py-4"

export const PIN_DOT_BASE = "size-3 rounded-full"

export const PIN_DOT_EMPTY = "shadow-[inset_0_0_0_1.5px_var(--be-hairline-strong)]"

export const PIN_DOT_FILLED = "bg-ink"

export const PIN_PROMPT = "text-center font-ui text-base font-semibold text-fg"
