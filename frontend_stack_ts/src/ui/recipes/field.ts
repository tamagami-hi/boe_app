export const FIELD_ROOT = "flex flex-col gap-2"

export const FIELD_LABEL =
  "font-ui text-xs font-semibold uppercase tracking-[0.06em] text-fg-muted"

export const FIELD_REQUIRED = "ml-[3px] text-gold-deep"

export const FIELD_HINT = "font-ui text-xs leading-normal text-fg-faint"

export const FIELD_ERROR = "font-ui text-xs font-semibold text-negative"

export const INPUT_BASE = [
  "w-full min-h-[50px] lg:min-h-[46px] px-4",
  "rounded-squircle-sm border-0 bg-field text-fg",
  "font-ui text-md",
  "shadow-field",
  "transition-[box-shadow,background-color] duration-200 ease-out",
  "enabled:hover:bg-field-hover",
  "focus:outline-none focus:bg-white focus:shadow-field-focus",
  "disabled:cursor-not-allowed disabled:opacity-40",
].join(" ")

export const INPUT_INVALID = "shadow-field-invalid focus:shadow-field-invalid-focus"

export const INPUT_MONO = "font-mono text-lg tracking-[0.16em]"

export const SELECT_BASE = [
  "w-full min-h-target px-3 pr-8",
  "appearance-none cursor-pointer select-caret",
  "rounded-squircle-sm border-0 bg-field text-fg font-ui text-base",
  "ring-inset-field",
  "focus:outline-none focus:ring-focus-ink",
  "disabled:cursor-not-allowed disabled:opacity-55",
].join(" ")

export const TEXTAREA_BASE = [
  "w-full min-h-30 p-3",
  "rounded-squircle-sm border-0 bg-field text-fg",
  "font-ui text-base leading-normal resize-y",
  "ring-inset-field",
  "focus:outline-none focus:ring-focus-ink",
].join(" ")

export const TEXTAREA_INVALID = "ring-inset-invalid"

export const AMOUNT_WRAP = "relative flex items-center"

export const AMOUNT_SYMBOL = [
  "pointer-events-none absolute left-3",
  "font-numeric text-xl font-semibold text-fg-muted",
].join(" ")

export const AMOUNT_INPUT = [
  "w-full min-h-16 pl-7 pr-3",
  "rounded-squircle border-0 bg-field text-fg",
  "money text-[clamp(1.75rem,7vw,2.25rem)] font-semibold tracking-[-0.024em]",
  "ring-inset-field",
  "focus:outline-none focus:ring-focus-ink",
].join(" ")

export const AMOUNT_INVALID = "ring-inset-invalid"

export const PRESET_ROW = "flex flex-wrap gap-2"

export const PRESET_BASE = [
  "min-h-target lg:min-h-target-compact px-3 rounded-full border-0 cursor-pointer",
  "font-numeric text-sm font-semibold [font-variant-numeric:tabular-nums]",
  "transition-colors duration-200 ease-out",
].join(" ")

export const PRESET_REST = "bg-shell shadow-hairline text-fg-muted hover:bg-shell-strong hover:text-fg"

export const PRESET_ACTIVE = "bg-ink text-fg-inverse shadow-none"

export const SWITCH_ROW = "flex items-center justify-between gap-4 py-3"

export const SWITCH_TEXT = "flex flex-col gap-0.5"

export const SWITCH_LABEL = "font-ui text-base font-semibold text-fg"

export const SWITCH_HINT = "font-ui text-xs text-fg-muted max-w-[46ch]"

export const SWITCH_BASE = [
  "relative flex-none w-[46px] h-7 rounded-full border-0 cursor-pointer",
  "transition-colors duration-200 ease-out",
  "disabled:cursor-not-allowed disabled:opacity-50",
].join(" ")

export const SWITCH_OFF = "bg-sand ring-inset-hairline-strong"

export const SWITCH_ON = "bg-ink shadow-none"

export const SWITCH_KNOB = [
  "absolute top-[3px] left-[3px] size-[22px] rounded-full bg-white",
  "shadow-[0_1px_3px_rgb(var(--be-tint-warm)/30%)]",
  "transition-transform duration-200 ease-spring",
].join(" ")

export const SWITCH_KNOB_ON = "translate-x-[18px]"

export const RADIO_GROUP = "flex flex-col gap-2"

export const RADIO_BASE = [
  "flex items-start gap-3 p-3 text-left cursor-pointer",
  "rounded-squircle-sm border-0 bg-parchment",
  "transition-shadow duration-200 ease-out",
].join(" ")

export const RADIO_REST = "ring-inset-hairline"

export const RADIO_ACTIVE = "ring-inset-selected"

export const RADIO_MARK_BASE = "mt-0.5 size-4 flex-none rounded-full"

export const RADIO_MARK_REST = "shadow-[inset_0_0_0_1.5px_var(--be-hairline-strong)]"

export const RADIO_MARK_ACTIVE = "shadow-[inset_0_0_0_5px_var(--be-ink)]"

export const RADIO_TEXT = "flex flex-col gap-0.5"

export const RADIO_LABEL = "font-ui text-base font-semibold text-fg"

export const CHECKBOX_ROW = [
  "flex w-full items-start gap-3 p-3 text-left cursor-pointer",
  "rounded-squircle-sm border-0 bg-shell",
].join(" ")

export const CHECKBOX_MARK_BASE = "mt-px size-4.5 flex-none rounded-sm"

export const CHECKBOX_MARK_OFF = "bg-parchment ring-inset-hairline-strong"

export const CHECKBOX_MARK_ON = "grid place-items-center bg-ink text-fg-inverse shadow-none"

export const CHECKBOX_GLYPH = "size-3"

export const TABS_ROOT = [
  "inline-flex max-w-full self-start gap-1 p-1",
  "rounded-full bg-shell shadow-hairline",
  "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
].join(" ")

export const TAB_BASE = [
  "flex-none min-h-target lg:min-h-target-compact px-4 rounded-full border-0",
  "font-ui text-sm font-semibold whitespace-nowrap cursor-pointer",
  "transition-[color,background-color] duration-200 ease-out",
].join(" ")

export const TAB_REST = "bg-transparent text-fg-muted hover:text-fg"

export const TAB_ACTIVE = "bg-parchment text-fg inset-shadow-lift-soft shadow-ambient-1"
