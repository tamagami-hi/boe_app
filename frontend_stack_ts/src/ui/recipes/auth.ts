export const AUTH_SHELL = [
  "relative grid min-h-dvh grid-cols-1 grid-rows-[auto_1fr_auto] overflow-hidden bg-bg",
  "lg:grid-cols-[1.02fr_0.98fr] lg:grid-rows-1 lg:items-stretch",
].join(" ")

export const AUTH_MESH = "pointer-events-none absolute inset-0 z-0 mesh-warm lg:right-[49%]"

export const AUTH_NARRATIVE = [
  "relative z-2 flex flex-col justify-center gap-4 lg:gap-6",
  "px-[max(var(--be-space-5),var(--be-safe-left))]",
  "pt-[calc(var(--be-space-8)+var(--be-safe-top))] pb-5",
  "lg:px-10 lg:py-12 lg:pt-12",
  "lg:bg-gradient-to-b lg:from-[color-mix(in_srgb,var(--be-sand)_46%,transparent)] lg:to-transparent",
  "lg:shadow-[inset_-1px_0_0_var(--be-hairline)]",
].join(" ")

export const AUTH_HEADLINE = [
  "m-0 max-w-[15ch] lg:max-w-[14ch] font-display font-light text-fg",
  "text-display lg:text-display-lg",
].join(" ")

export const AUTH_TAGLINE =
  "m-0 max-w-[36ch] lg:max-w-[40ch] font-ui text-md lg:text-lg leading-relaxed text-fg-muted"

export const AUTH_MARKERS = [
  "m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0",
  "lg:mt-3 lg:max-w-[46ch] lg:flex-col lg:flex-nowrap lg:gap-0",
].join(" ")

export const AUTH_MARKER = [
  "inline-flex items-center gap-2 font-ui text-xs font-medium text-fg-faint",
  "lg:justify-start lg:gap-3 lg:border-t lg:border-hairline lg:py-3",
  "lg:text-sm lg:text-fg-muted lg:last:border-b",
].join(" ")

export const AUTH_MARKER_DOT = "size-1 lg:size-[5px] rounded-full bg-gold"

export const AUTH_PANEL_AREA = [
  "relative z-2 flex items-start justify-center",
  "px-[max(var(--be-space-4),var(--be-safe-left))] pb-8",
  "lg:items-center lg:bg-parchment lg:px-10 lg:py-12 lg:pl-8",
].join(" ")

export const AUTH_PANEL_SLOT = "w-full max-w-panel lg:max-w-[460px]"

export const AUTH_PANEL_SHELL = "w-full shell-outer-lg"

export const AUTH_PANEL_CORE = [
  "flex flex-col gap-5 lg:gap-6 p-6 lg:p-10",
  "rounded-[calc(var(--be-squircle-xl)-var(--be-shell-pad-lg))]",
  "grad-core inset-shadow-lift shadow-ambient-3",
].join(" ")

export const AUTH_PANEL_HEAD =
  "flex flex-col gap-2 border-b border-hairline pb-4"

export const AUTH_WORDMARK =
  "font-display text-base font-medium tracking-tight text-gold-deep"

export const AUTH_PANEL_TITLE =
  "m-0 font-display text-xl lg:text-2xl font-normal leading-snug tracking-display text-fg"

export const AUTH_FOOTNOTE = [
  "relative z-2 m-0 text-center font-ui text-xs text-fg-faint",
  "px-[max(var(--be-space-5),var(--be-safe-left))]",
  "pb-[calc(var(--be-space-5)+var(--be-safe-bottom))]",
  "lg:absolute lg:bottom-0 lg:left-0 lg:w-[51%] lg:px-10 lg:pb-8 lg:text-left",
].join(" ")
