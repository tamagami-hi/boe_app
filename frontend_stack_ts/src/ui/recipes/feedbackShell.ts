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
  "pointer-events-auto block w-full rounded-md border px-4 py-3",
  "font-ui text-sm leading-snug shadow-elev-2",
].join(" ")

export const TOAST_TONE = {
  default: "border-rule bg-bg-inverse text-fg-inverse",
  error: "border-negative bg-negative text-fg-inverse",
} as const
