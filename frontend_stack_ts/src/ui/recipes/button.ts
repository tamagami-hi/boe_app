export type ButtonTone = "primary" | "gold" | "secondary" | "ghost" | "danger"
export type ButtonSize = "sm" | "md" | "lg"

export const BUTTON_BASE = [
  "group relative inline-flex items-center justify-center gap-2",
  "rounded-full border border-transparent isolate no-tap-flash",
  "font-ui font-semibold tracking-tight leading-none",
  "cursor-pointer select-none no-underline",
  "transition-[transform,box-shadow,background-color,color] duration-200 ease-spring",
  "enabled:active:scale-[0.978] enabled:hover:-translate-y-[1.5px]",
  "disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none",
].join(" ")

export const BUTTON_TONE: Readonly<Record<ButtonTone, string>> = {
  primary: "grad-solid text-parchment shadow-btn-solid enabled:hover:shadow-btn-solid-hover",
  gold: "grad-gold text-parchment shadow-btn-gold enabled:hover:shadow-btn-gold-hover",
  secondary: "grad-quiet text-fg shadow-btn-quiet enabled:hover:shadow-btn-quiet-hover",
  ghost: "bg-transparent text-fg-muted enabled:hover:bg-shell enabled:hover:text-fg",
  danger: "grad-danger text-parchment shadow-btn-solid enabled:hover:shadow-btn-solid-hover",
}

export const BUTTON_SIZE: Readonly<Record<ButtonSize, string>> = {
  sm: "min-h-target lg:min-h-target-compact px-4 text-sm",
  md: "min-h-target lg:min-h-target-md px-5 text-base",
  lg: "min-h-[52px] lg:min-h-[48px] px-6 text-md",
}

const TRAIL_BASE = [
  "inline-flex flex-none items-center justify-center",
  "size-[30px] -mr-3 ml-1 rounded-full",
  "transition-[transform,background-color] duration-200 ease-spring",
  "group-hover:translate-x-[2px] group-hover:-translate-y-px group-hover:scale-[1.06]",
].join(" ")

export const BUTTON_TRAIL: Readonly<Record<ButtonTone, string>> = {
  primary: `${TRAIL_BASE} bg-white/15 group-hover:bg-white/25`,
  gold: `${TRAIL_BASE} bg-white/15 group-hover:bg-white/25`,
  danger: `${TRAIL_BASE} bg-white/15 group-hover:bg-white/25`,
  secondary: `${TRAIL_BASE} bg-shell-strong shadow-hairline`,
  ghost: `${TRAIL_BASE} bg-shell-strong shadow-hairline`,
}

export const BUTTON_SPINNER = [
  "size-icon-sm rounded-full border-[1.5px] border-current border-t-transparent",
  "motion-safe:animate-[be-spin_720ms_var(--be-ease-in-out)_infinite]",
  "motion-reduce:opacity-60",
].join(" ")
