export const SCRIM = [
  "fixed inset-0 z-overlay flex justify-center",
  "items-end lg:items-center",
  "bg-[color-mix(in_srgb,var(--be-espresso)_34%,transparent)] backdrop-blur-[6px]",
  "motion-safe:animate-[be-fade-in_var(--be-dur-base)_var(--be-ease-out)_both]",
].join(" ")

export const SHEET_PANEL = [
  "relative flex w-full flex-col gap-4 overflow-y-auto",
  "max-h-[88dvh] lg:max-h-[80dvh] lg:max-w-panel",
  "px-[max(var(--be-space-5),var(--be-safe-left))]",
  "pt-5 pb-[calc(var(--be-space-6)+var(--be-safe-bottom))]",
  "lg:p-7",
  "rounded-t-squircle-xl lg:rounded-squircle-lg",
  "bg-parchment shadow-ambient-3",
  "motion-safe:animate-[be-sheet-up_var(--be-dur-slow)_var(--be-ease-out)_both]",
  "lg:motion-safe:animate-[be-fade-in_var(--be-dur-slow)_var(--be-ease-out)_both]",
].join(" ")

export const SHEET_GRIP =
  "self-center h-1 w-10 rounded-full bg-hairline-strong lg:hidden"

export const SHEET_HEAD = "flex flex-col gap-1"

export const SHEET_TITLE = "m-0 font-display text-xl font-normal tracking-display text-fg"

export const SHEET_DESCRIPTION = "m-0 font-ui text-sm leading-normal text-fg-muted"

export const SHEET_BODY = "flex flex-col gap-3"

export const SHEET_ACTIONS = "flex flex-col gap-2 lg:flex-row lg:justify-end"
