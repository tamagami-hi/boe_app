export { APP_SHELL as ADMIN_SHELL } from "~/ui/recipes/layout"

export const ADMIN_MESH = [
  "pointer-events-none fixed inset-0 z-0",
  "bg-[image:var(--be-mesh-sage),var(--be-mesh-clay)]",
].join(" ")

export const ADMIN_TOPBAR = [
  "sticky top-0 z-header flex items-center gap-3",
  "min-h-[calc(var(--be-header-h)+var(--be-safe-top))]",
  "px-[max(var(--be-space-5),var(--be-safe-left))]",
  "pt-[calc(var(--be-space-2)+var(--be-safe-top))] pb-2",
  "bg-[color-mix(in_srgb,var(--be-parchment-2)_78%,transparent)]",
  "backdrop-blur-[18px] backdrop-saturate-150",
  "shadow-[0_1px_0_var(--be-hairline)]",
  "lg:min-h-0 lg:justify-end lg:bg-transparent lg:px-10 lg:pt-8 lg:pb-4",
  "lg:shadow-none lg:backdrop-blur-none lg:backdrop-saturate-100",
].join(" ")

export const ADMIN_TITLE =
  "flex-1 font-display text-lg font-normal tracking-display text-fg lg:hidden"

export const ADMIN_ACTION = [
  "min-h-target rounded-full border-0 bg-parchment px-4",
  "shadow-[0_0_0_1px_var(--be-hairline-strong),var(--be-ambient-1)]",
  "font-ui text-sm font-semibold text-fg-muted cursor-pointer",
  "transition-[color,transform] duration-200 ease-spring",
  "hover:text-fg active:scale-[0.97] motion-reduce:active:scale-100",
].join(" ")

export const ADMIN_DOMAIN_STRIP = [
  "relative z-1 flex gap-2 overflow-x-auto lg:hidden",
  "px-[max(var(--be-space-5),var(--be-safe-left))] py-3",
  "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
].join(" ")

export const ADMIN_DOMAIN_LINK = [
  "flex-none inline-flex items-center min-h-target rounded-full px-4 no-underline whitespace-nowrap",
  "bg-shell shadow-hairline text-fg-muted",
  "font-ui text-xs font-semibold",
  "transition-[color,background-color] duration-200 ease-out",
  "hover:text-fg",
  "aria-[current=page]:grad-solid aria-[current=page]:text-parchment",
  "aria-[current=page]:shadow-ambient-1",
].join(" ")

export const ADMIN_BODY = "relative z-1 flex min-w-0 flex-1"

export const ADMIN_CONTENT = "flex min-w-0 flex-1 flex-col"

export const ADMIN_SIDEBAR = [
  "hidden lg:sticky lg:top-6 lg:flex lg:flex-none lg:flex-col lg:gap-0.5 lg:self-start",
  "lg:w-sidebar lg:px-4 lg:py-8 lg:my-6 lg:ml-6",
  "lg:rounded-squircle-xl",
  "lg:bg-[color-mix(in_srgb,var(--be-parchment)_66%,transparent)]",
  "lg:backdrop-blur-[20px] lg:backdrop-saturate-150",
  "lg:shadow-hairline lg:inset-shadow-lift-soft",
].join(" ")

export const ADMIN_WORDMARK =
  "mb-5 px-3 font-display text-md font-medium tracking-display text-fg"

export const ADMIN_SIDEBAR_LINK = [
  "block rounded-full px-3 py-2 no-underline",
  "font-ui text-sm font-semibold text-fg-muted",
  "transition-[color,background-color,transform] duration-200 ease-spring",
  "hover:translate-x-0.5 hover:bg-shell hover:text-fg",
  "motion-reduce:hover:translate-x-0",
  "aria-[current=page]:grad-quiet aria-[current=page]:text-fg",
  "aria-[current=page]:shadow-hairline",
].join(" ")

export const ADMIN_BOTTOM_NAV = [
  "sticky bottom-0 z-nav grid grid-flow-col auto-cols-fr lg:hidden",
  "bg-[color-mix(in_srgb,var(--be-parchment)_82%,transparent)]",
  "backdrop-blur-[22px] backdrop-saturate-[1.6]",
  "shadow-[0_-1px_0_var(--be-hairline),0_-18px_40px_-28px_rgb(var(--be-tint-warm)/22%)]",
  "pb-safe-bottom",
].join(" ")

export const ADMIN_NAV_ITEM = [
  "flex min-h-nav items-center justify-center px-1 py-2",
  "text-center no-underline font-ui text-2xs font-semibold tracking-[0.03em] text-fg-faint",
  "transition-colors duration-200 ease-out",
  "aria-[current=page]:text-fg",
].join(" ")
