export const STATE_PANEL = [
  "mx-auto flex w-full flex-col items-center gap-3 text-center",
  "rounded-squircle-lg bg-parchment px-5 py-8",
  "shadow-hairline inset-shadow-lift-soft",
  "lg:max-w-[46rem]",
].join(" ")

export const STATE_PANEL_ERROR = [
  "mx-auto flex w-full flex-col items-center gap-3 text-center",
  "rounded-squircle-lg border px-5 py-8 tone-negative",
  "lg:max-w-[46rem]",
].join(" ")

export const STATE_TITLE =
  "font-display text-xl font-normal tracking-display text-fg"

export const STATE_DESCRIPTION = "max-w-[52ch] font-ui text-sm leading-relaxed text-fg-muted"

export const STATE_REFERENCE = "font-mono text-xs text-fg-faint [overflow-wrap:anywhere]"

export const STATE_REFRESH_SLOT = "-mb-3 flex h-0 items-end justify-end"

export const STATE_REFRESHING = "flex items-center gap-2 font-ui text-xs text-fg-muted"

export const STATE_STACK = "flex flex-col gap-3"

export const LOAD_MORE_ROOT = "flex flex-col items-center gap-2 pt-4"
