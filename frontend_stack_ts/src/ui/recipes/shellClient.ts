export { APP_SHELL as CLIENT_SHELL, BOTTOM_NAV as CLIENT_BOTTOM_NAV } from "~/ui/recipes/layout"

export const CLIENT_MESH = [
  "pointer-events-none fixed inset-0 z-0",
  "bg-[image:var(--be-mesh-gold),var(--be-mesh-clay)]",
].join(" ")

export const CLIENT_HEADER = [
  "sticky top-[var(--be-chrome-offset)] z-header flex items-center gap-2 lg:hidden",
  "min-h-[calc(var(--be-header-h)+var(--be-chrome-safe-top))]",
  "px-[max(var(--be-space-4),var(--be-safe-left))]",
  "pt-[calc(var(--be-space-2)+var(--be-chrome-safe-top))] pb-2",
  "bg-[color-mix(in_srgb,var(--be-parchment-2)_78%,transparent)]",
  "backdrop-blur-[18px] backdrop-saturate-150",
  "shadow-[0_1px_0_var(--be-hairline)]",
].join(" ")

export const CLIENT_SPACER = "flex-1"

export const ICON_ACTION = [
  "inline-flex items-center justify-center tap-target rounded-full",
  "border-0 bg-transparent text-fg-muted cursor-pointer no-tap-flash",
  "transition-[background-color,color,transform] duration-200 ease-spring",
  "hover:text-fg hover:bg-shell active:scale-[0.94]",
].join(" ")

export const ICON_GLYPH = "size-icon-md"

export const BELL_WRAP = "relative inline-flex"

export const BELL_COUNT = [
  "pointer-events-none absolute right-[3px] top-[3px]",
  "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1",
  "bg-gold text-espresso font-numeric text-2xs font-semibold leading-none",
  "[font-variant-numeric:tabular-nums]",
  "shadow-[0_0_0_2px_var(--be-parchment-2)]",
].join(" ")

export const BELL_COUNT_NAV = [
  "pointer-events-none absolute -right-1 -top-1",
  "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1",
  "bg-gold text-espresso font-numeric text-2xs font-semibold leading-none",
  "[font-variant-numeric:tabular-nums]",
  "shadow-[0_0_0_2px_color-mix(in_srgb,var(--be-espresso)_92%,transparent)]",
].join(" ")

export const CLIENT_CONTENT = "relative z-1 flex flex-1 flex-col"

export const CLIENT_NAV_ITEM = [
  "group relative flex min-h-nav flex-col items-center justify-center gap-[5px]",
  "border-0 bg-transparent px-1 py-2 no-underline cursor-pointer no-tap-flash",
  "font-ui text-2xs font-semibold tracking-[0.03em] text-nav-fg-muted",
  "transition-colors duration-200 ease-out",
  "focus-visible:outline-focus-inverse",
  "aria-[current=page]:text-nav-fg",
].join(" ")

export const CLIENT_NAV_GLYPH = [
  "size-icon-md transition-transform duration-200 ease-spring",
  "group-aria-[current=page]:-translate-y-px",
].join(" ")

export const CLIENT_NAV_MARKER = [
  "absolute top-1.5 size-1 rounded-full bg-gold",
  "scale-40 opacity-0",
  "transition-[opacity,transform] duration-200 ease-spring",
  "group-aria-[current=page]:scale-100 group-aria-[current=page]:opacity-100",
].join(" ")

export const CLIENT_TOP_NAV = [
  "hidden lg:sticky lg:top-[var(--be-chrome-offset)] lg:z-header lg:flex lg:justify-center",
  "lg:pointer-events-none lg:px-8 lg:pt-6 lg:pb-2",
].join(" ")

export const CLIENT_ISLAND = [
  "pointer-events-auto flex items-center gap-5",
  "rounded-full p-shell-pad pl-6",
  "bg-nav-bg backdrop-blur-[24px] backdrop-saturate-[1.7]",
  "shadow-nav-hairline inset-shadow-nav",
].join(" ")

export const CLIENT_WORDMARK =
  "whitespace-nowrap font-display text-md font-medium tracking-display text-nav-fg"

export const CLIENT_TOP_NAV_LIST = "m-0 flex list-none gap-1 p-0"

export const CLIENT_TOP_NAV_ITEM = [
  "relative inline-flex min-h-target-compact items-center rounded-full px-4",
  "font-ui text-sm font-semibold no-underline whitespace-nowrap text-nav-fg-muted",
  "transition-[color,background-color] duration-200 ease-out",
  "hover:bg-nav-surface hover:text-nav-fg",
  "aria-[current=page]:text-nav-fg aria-[current=page]:bg-nav-surface-strong",
  "aria-[current=page]:shadow-nav-hairline",
  "focus-visible:outline-focus-inverse",
].join(" ")

export const CLIENT_BELL = [
  "inline-flex size-[38px] items-center justify-center rounded-full",
  "bg-nav-surface shadow-nav-hairline text-nav-fg-muted",
  "transition-[transform,color] duration-200 ease-spring",
  "hover:-translate-y-px hover:text-nav-fg",
  "focus-visible:outline-focus-inverse",
].join(" ")
