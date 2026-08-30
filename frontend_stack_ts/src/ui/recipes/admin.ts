import { STAT_LABEL } from "~/ui/recipes/datalist"
import { MONEY_BASE, REFERENCE_TEXT } from "~/ui/recipes/text"

export const ADMIN_CONTROLS = [
  "flex flex-col gap-3",
  "sm:flex-row sm:items-center sm:gap-4 sm:[&>*]:flex-1",
].join(" ")

export const ADMIN_FILTER_ROW = "flex flex-wrap items-center gap-2"

export const ADMIN_FILTER = [
  "min-h-target lg:min-h-target-md px-3",
  "cursor-pointer rounded-full border border-rule-strong bg-transparent",
  "font-ui text-sm font-semibold text-fg-muted",
  "transition-[color,background-color,border-color] duration-200 ease-out",
  "hover:text-fg",
  "aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-fg-inverse",
].join(" ")

export const ADMIN_META = "flex flex-wrap gap-4 font-ui text-xs text-fg-muted"

export const ADMIN_FORM_GRID = [
  "grid grid-cols-1 gap-4",
  "lg:max-w-[72rem] lg:grid-cols-2",
  "xl:grid-cols-3",
].join(" ")

export const ADMIN_SUMMARY_GRID = "grid grid-cols-2 gap-4 lg:grid-cols-4"

export const ADMIN_FIGURE = [MONEY_BASE, "font-semibold tracking-[-0.008em]"].join(" ")

export const ADMIN_QUEUE_COUNT = [
  MONEY_BASE,
  "text-3xl font-semibold leading-tight tracking-[-0.03em] text-fg",
].join(" ")

export const ADMIN_LABEL = ["block", STAT_LABEL].join(" ")

export const ADMIN_CODE = [REFERENCE_TEXT, "[overflow-wrap:anywhere]"].join(" ")

export const ADMIN_TABLE_WRAP = "rounded-squircle-lg bg-shell p-shell-pad shadow-hairline"

export const ADMIN_TABLE_INNER = [
  "overflow-x-auto",
  "rounded-[calc(var(--be-squircle-lg)-var(--be-shell-pad))]",
  "bg-parchment inset-shadow-lift-soft shadow-ambient-1",
].join(" ")

export const ADMIN_TABLE = "w-full min-w-[42rem] border-collapse"

export const ADMIN_HEAD_CELL = [
  "border-b border-hairline px-4 py-3",
  "bg-[color-mix(in_srgb,var(--be-sand)_32%,transparent)]",
  "text-left whitespace-nowrap",
  "font-ui text-2xs font-semibold uppercase tracking-[0.16em] text-fg-muted",
].join(" ")

export const ADMIN_BODY_ROW = [
  "transition-colors duration-200 ease-out",
  "hover:bg-[color-mix(in_srgb,var(--be-sand)_20%,transparent)]",
  "last:[&>td]:border-b-0",
].join(" ")

export const ADMIN_CELL = [
  "border-b border-hairline px-4 py-3 align-middle",
  "font-ui text-sm text-fg",
].join(" ")

export const ADMIN_NUMERIC = "text-right"

export const ADMIN_CELL_LINK = [
  "font-semibold text-inherit no-underline",
  "hover:underline hover:underline-offset-[3px]",
].join(" ")

export const ADMIN_JSON_AREA = [
  "w-full min-h-[16rem] resize-y p-3",
  "rounded-squircle-sm border-0 bg-espresso text-parchment",
  "font-mono text-sm leading-normal [tab-size:2]",
  "shadow-[inset_0_0_0_1px_var(--be-hairline-strong)]",
  "focus:outline-none focus:shadow-[inset_0_0_0_1px_var(--be-gold)]",
].join(" ")
