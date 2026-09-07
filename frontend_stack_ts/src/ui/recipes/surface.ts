export type CardTone = "plain" | "elevated" | "feature"
export type StatusTone = "neutral" | "positive" | "negative" | "warning" | "info"

export const TONE_CLASS: Readonly<Record<StatusTone, string>> = {
  neutral: "tone-neutral",
  positive: "tone-positive",
  negative: "tone-negative",
  warning: "tone-warning",
  info: "tone-info",
}

export const SHELL = [
  "rounded-squircle-lg lg:rounded-squircle-xl",
  "bg-shell p-shell-pad lg:p-shell-pad-lg",
  "shadow-hairline transition-shadow duration-200 ease-spring",
  "has-[[data-interactive]:hover]:shadow-hairline-strong",
].join(" ")

export const CARD_BASE = [
  "flex flex-col gap-3",
  "p-5 md:p-6 lg:p-7",
  "rounded-[calc(var(--be-squircle-lg)-var(--be-shell-pad))]",
  "lg:rounded-[calc(var(--be-squircle-xl)-var(--be-shell-pad-lg))]",
].join(" ")

export const CARD_TONE: Readonly<Record<CardTone, string>> = {
  plain: "card-face shadow-ambient-1 inset-shadow-lift",
  elevated: "card-face shadow-ambient-2 inset-shadow-lift",
  feature: "card-face-feature shadow-ambient-3 inset-shadow-lift",
}

export const CARD_STACK = "flex flex-col gap-3"

export const CARD_ACTION = "mt-3 self-start no-underline"


export const CARD_LINK = "block text-inherit no-underline"

export const EYEBROW = [
  "inline-flex items-center self-start",
  "rounded-full bg-shell-strong px-3 py-1",
  "shadow-hairline inset-shadow-lift-soft",
  "font-ui text-2xs font-semibold uppercase tracking-wide text-fg-muted",
].join(" ")

export const BADGE_BASE = [
  "inline-flex items-center gap-1 whitespace-nowrap",
  "rounded-full border px-2 py-[3px]",
  "font-ui text-xs font-semibold leading-[1.55]",
  "inset-shadow-lift-soft",
].join(" ")

export const ALERT_BASE = [
  "flex flex-col gap-1",
  "rounded-squircle border px-5 py-4",
  "font-ui text-sm leading-relaxed",
].join(" ")

export const ALERT_TITLE = "font-semibold tracking-tight"

export const ALERT_ACTION = "mt-1 flex flex-wrap items-center gap-2 self-start"

export const INSET_NOTE = [
  "rounded-squircle-sm bg-shell p-3",
  "font-ui text-sm leading-normal text-fg",
].join(" ")

export const SPINNER_BASE = [
  "inline-block rounded-full",
  "border-[1.5px] border-hairline-strong border-t-gold",
  "motion-safe:animate-[be-spin_780ms_var(--be-ease-in-out)_infinite]",
].join(" ")

export const SPINNER_SIZE: Readonly<Record<"sm" | "md", string>> = {
  sm: "size-icon-sm",
  md: "size-icon-lg",
}

export const SKELETON = "be-skeleton"

export const SKELETON_CIRCLE = "rounded-full"
