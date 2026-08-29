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

export const BLOCK_LAYER = [
  "fixed inset-0 z-toast flex justify-center overflow-y-auto",
  "bg-bg",
  "px-[max(var(--be-page-pad-x),var(--be-safe-left))]",
  "pt-[calc(var(--be-space-8)+var(--be-safe-top))]",
  "pb-[calc(var(--be-space-8)+var(--be-safe-bottom))]",
  "motion-safe:animate-[be-fade-in_var(--be-dur-base)_var(--be-ease-out)_both]",
].join(" ")

export const BLOCK_PANEL = "flex w-full max-w-form flex-col gap-6 self-center"

export const BLOCK_HEAD = "flex flex-col items-center gap-2 text-center"

export const BLOCK_MARK = "font-display text-lg font-medium tracking-display text-gold-deep"

export const BLOCK_PROGRESS_TRACK = [
  "h-1.5 w-full overflow-hidden rounded-full bg-shell-strong",
  "shadow-hairline",
].join(" ")

export const BLOCK_PROGRESS_FILL = [
  "h-full w-full origin-left rounded-full grad-gold",
  "transition-transform duration-[var(--be-dur-base)] ease-out",
].join(" ")
