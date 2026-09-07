export const CONNECTIVITY_BANNER = [
  "sticky top-0 z-sticky text-center",
  "px-[max(var(--be-space-4),var(--be-safe-left))]",
  "pt-[calc(var(--be-space-2)+var(--be-safe-top))] pb-2",
  "bg-warning text-fg-inverse font-ui text-xs font-semibold",
].join(" ")

export const TOAST_REGION = [
  "pointer-events-none fixed left-1/2 z-toast flex -translate-x-1/2 flex-col items-center gap-2",
  "bottom-[calc(var(--be-nav-h)+var(--be-safe-bottom)+var(--be-space-5))]",
  "w-[min(100%-2*var(--be-space-4),420px)]",
  "lg:left-auto lg:right-8 lg:bottom-8 lg:translate-x-0 lg:items-end",
].join(" ")

export const TOAST_BASE = [
  "pointer-events-auto flex w-full items-start gap-3",
  "rounded-squircle px-4 py-3",
  "font-ui text-sm leading-snug",
  "inset-shadow-nav shadow-ambient-3",
].join(" ")

export const TOAST_TONE = {
  default: "bg-nav-bg text-nav-fg",
  error: "bg-negative text-fg-inverse",
} as const

export const TOAST_MESSAGE = "min-w-0 flex-1"

export const TOAST_DISMISS = [
  "-my-1 -mr-2 flex-none tap-target rounded-full",
  "border-0 bg-transparent text-current opacity-70 cursor-pointer no-tap-flash",
  "transition-opacity duration-200 ease-out hover:opacity-100",
  "focus-visible:outline-focus-inverse",
].join(" ")
