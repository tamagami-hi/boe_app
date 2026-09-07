import { useRef } from "react"
import type { KeyboardEvent } from "react"

import { cx } from "~/lib/cx"
import { PRESET_ACTIVE, PRESET_BASE, PRESET_REST, PRESET_ROW, RADIO_ACTIVE, RADIO_BASE, CONTROL_LABEL, RADIO_GROUP, RADIO_MARK_ACTIVE, RADIO_MARK_BASE, RADIO_MARK_REST, RADIO_REST, RADIO_TEXT, SWITCH_BASE, SWITCH_HINT, SWITCH_HIT, SWITCH_KNOB, SWITCH_KNOB_ON, SWITCH_OFF, SWITCH_ON, SWITCH_ROW, SWITCH_TEXT, TABS_ROOT, TAB_ACTIVE, TAB_BASE, TAB_PANEL, TAB_REST } from "~/ui/recipes/field"
import { HINT_MUTED } from "~/ui/recipes/text"

const ROVING_KEYS = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"] as const

const nextRovingIndex = (key: string, current: number, count: number): number => {
  if (key === "Home") return 0
  if (key === "End") return count - 1
  if (key === "ArrowRight" || key === "ArrowDown") return (current + 1) % count
  return (current - 1 + count) % count
}

export type SwitchProps = Readonly<{
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}>

export const Switch = ({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: SwitchProps): React.ReactElement => (
  <div className={SWITCH_ROW}>
    <span className={SWITCH_TEXT}>
      <span className={CONTROL_LABEL}>{label}</span>
      {hint === undefined ? null : <span className={SWITCH_HINT}>{hint}</span>}
    </span>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={SWITCH_HIT}
      onClick={() => {
        onChange(!checked)
      }}
    >
      <span className={cx(SWITCH_BASE, checked ? SWITCH_ON : SWITCH_OFF)} aria-hidden="true">
        <span className={cx(SWITCH_KNOB, checked ? SWITCH_KNOB_ON : undefined)} />
      </span>
    </button>
  </div>
)

export type RadioOption<TValue extends string> = Readonly<{
  value: TValue
  label: string
  hint?: string
  disabled?: boolean
}>

export type RadioGroupProps<TValue extends string> = Readonly<{
  legend: string
  value: TValue
  options: readonly RadioOption<TValue>[]
  onChange: (next: TValue) => void
}>

export const RadioGroup = <TValue extends string>({
  legend,
  value,
  options,
  onChange,
}: RadioGroupProps<TValue>): React.ReactElement => {
  const group = useRef<HTMLDivElement | null>(null)
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!ROVING_KEYS.includes(event.key as (typeof ROVING_KEYS)[number])) return
    const enabled = options.filter((option) => option.disabled !== true)
    if (enabled.length === 0) return
    event.preventDefault()
    const currentEnabled = Math.max(
      0,
      enabled.findIndex((option) => option.value === value),
    )
    const target = enabled[nextRovingIndex(event.key, currentEnabled, enabled.length)]
    if (target === undefined) return
    onChange(target.value)
    const buttons = group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    const index = options.findIndex((option) => option.value === target.value)
    buttons?.item(index).focus()
  }

  return (
    <div
      ref={group}
      className={RADIO_GROUP}
      role="radiogroup"
      aria-label={legend}
      onKeyDown={onKeyDown}
    >
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === selectedIndex ? 0 : -1}
            disabled={option.disabled === true}
            className={cx(RADIO_BASE, selected ? RADIO_ACTIVE : RADIO_REST)}
            onClick={() => {
              onChange(option.value)
            }}
          >
            <span
              className={cx(RADIO_MARK_BASE, selected ? RADIO_MARK_ACTIVE : RADIO_MARK_REST)}
              aria-hidden="true"
            />
            <span className={RADIO_TEXT}>
              <span className={CONTROL_LABEL}>{option.label}</span>
              {option.hint === undefined ? null : <span className={HINT_MUTED}>{option.hint}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export type TabItem<TValue extends string> = Readonly<{ value: TValue; label: string }>

export type TabsProps<TValue extends string> = Readonly<{
  id: string
  label: string
  value: TValue
  items: readonly TabItem<TValue>[]
  onChange: (next: TValue) => void
}>

export const tabId = (base: string, value: string): string => `${base}-${value}-tab`

export const tabPanelId = (base: string, value: string): string => `${base}-${value}-panel`

export const Tabs = <TValue extends string>({
  id,
  label,
  value,
  items,
  onChange,
}: TabsProps<TValue>): React.ReactElement => {
  const list = useRef<HTMLDivElement | null>(null)
  const baseId = id
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  )

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!ROVING_KEYS.includes(event.key as (typeof ROVING_KEYS)[number])) return
    if (items.length === 0) return
    event.preventDefault()
    const target = items[nextRovingIndex(event.key, selectedIndex, items.length)]
    if (target === undefined) return
    onChange(target.value)
    const buttons = list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    buttons?.item(items.indexOf(target)).focus()
  }

  return (
    <div
      ref={list}
      className={TABS_ROOT}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {items.map((item, index) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          id={tabId(baseId, item.value)}
          aria-selected={item.value === value}
          aria-controls={tabPanelId(baseId, item.value)}
          tabIndex={index === selectedIndex ? 0 : -1}
          className={cx(TAB_BASE, item.value === value ? TAB_ACTIVE : TAB_REST)}
          onClick={() => {
            onChange(item.value)
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export type TabPanelProps = Readonly<{
  id: string
  value: string
  children: React.ReactNode
}>

export const TabPanel = ({ id, value, children }: TabPanelProps): React.ReactElement => (
  <div
    role="tabpanel"
    id={tabPanelId(id, value)}
    aria-labelledby={tabId(id, value)}
    tabIndex={-1}
    className={TAB_PANEL}
  >
    {children}
  </div>
)

export type PresetChoiceProps = Readonly<{
  label: string
  value: number
  options: readonly number[]
  format: (value: number) => string
  onChange: (next: number) => void
}>

export const PresetChoice = ({
  label,
  value,
  options,
  format,
  onChange,
}: PresetChoiceProps): React.ReactElement => (
  <div className={PRESET_ROW} role="group" aria-label={label}>
    {options.map((option) => (
      <button
        key={option}
        type="button"
        aria-pressed={option === value}
        className={cx(PRESET_BASE, option === value ? PRESET_ACTIVE : PRESET_REST)}
        onClick={() => {
          onChange(option)
        }}
      >
        {format(option)}
      </button>
    ))}
  </div>
)
