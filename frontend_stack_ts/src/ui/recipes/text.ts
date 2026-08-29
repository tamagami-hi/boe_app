export type MoneySize = "sm" | "md" | "lg" | "xl"
export type MoneyTone = "default" | "positive" | "negative" | "muted"

export const MONEY_BASE = "money whitespace-nowrap [font-feature-settings:'tnum'_1,'lnum'_1,'ss01'_1]"

export const MONEY_SIZE: Readonly<Record<MoneySize, string>> = {
  sm: "text-sm font-medium tracking-[-0.006em]",
  md: "text-md font-semibold tracking-[-0.01em]",
  lg: "text-xl font-semibold tracking-[-0.018em]",
  xl: "text-[clamp(2rem,7vw,2.75rem)] lg:text-[clamp(2.5rem,3.2vw,3.5rem)] font-semibold leading-[1.02] tracking-[-0.03em]",
}

export const MONEY_TONE: Readonly<Record<MoneyTone, string>> = {
  default: "text-fg",
  positive: "text-positive",
  negative: "text-negative",
  muted: "text-fg-muted",
}

export const PAGE_TITLE =
  "font-display text-2xl lg:text-3xl font-normal leading-snug tracking-display text-fg"

export const SECTION_TITLE =
  "font-display text-xl font-normal leading-snug tracking-display text-fg"

export const CARD_TITLE = "font-display text-lg font-medium leading-snug tracking-tight text-fg"

export const HERO_TITLE = "font-display text-display font-light tracking-display text-fg"

export const HERO_ACCENT = "italic font-normal text-gold-deep"

export const BODY_TEXT = "font-ui text-base leading-relaxed text-fg-muted"

export const BODY_SM = "font-ui text-sm leading-normal text-fg-muted"

export const META_TEXT = "font-ui text-xs leading-normal text-fg-faint"

export const META_MUTED = "font-ui text-xs text-fg-muted"

export const LABEL_TEXT = "font-ui text-xs font-semibold uppercase tracking-eyebrow text-fg-muted"

export const HONESTY_TEXT = "m-0 max-w-[64ch] font-ui text-sm leading-relaxed text-fg-muted"

export const META_ROW =
  "flex flex-wrap items-center gap-x-4 gap-y-2 font-ui text-xs text-fg-faint"

export const REFERENCE_TEXT = "font-mono text-xs tracking-[0.06em] text-fg-faint"

export const SUBHEAD_TITLE =
  "m-0 font-display text-lg font-normal tracking-[-0.015em] text-fg"

export const COUNT_TEXT =
  "font-numeric text-sm font-semibold [font-variant-numeric:tabular-nums] text-fg-muted"

export const RULE_GOLD =
  "block h-0.5 w-16 rounded-full bg-gradient-to-r from-gold to-transparent"

export const HINT_MUTED = "font-ui text-xs leading-normal text-fg-muted"
