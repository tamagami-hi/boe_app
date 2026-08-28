import { cx } from "~/lib/cx"

import styles from "./Controls.module.css"

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
  <div className={styles.switchRow}>
    <span className={styles.switchText}>
      <span className={styles.switchLabel}>{label}</span>
      {hint === undefined ? null : <span className={styles.switchHint}>{hint}</span>}
    </span>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={checked ? styles.switchOn : styles.switch}
      onClick={() => {
        onChange(!checked)
      }}
    >
      <span className={styles.switchKnob} />
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
}: RadioGroupProps<TValue>): React.ReactElement => (
  <div className={styles.radioGroup} role="radiogroup" aria-label={legend}>
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        role="radio"
        aria-checked={option.value === value}
        disabled={option.disabled === true}
        className={option.value === value ? styles.radioActive : styles.radio}
        onClick={() => {
          onChange(option.value)
        }}
      >
        <span className={styles.radioMark} aria-hidden="true" />
        <span className={styles.radioText}>
          <span className={styles.radioLabel}>{option.label}</span>
          {option.hint === undefined ? null : (
            <span className={styles.radioHint}>{option.hint}</span>
          )}
        </span>
      </button>
    ))}
  </div>
)

export type TabItem<TValue extends string> = Readonly<{ value: TValue; label: string }>

export type TabsProps<TValue extends string> = Readonly<{
  label: string
  value: TValue
  items: readonly TabItem<TValue>[]
  onChange: (next: TValue) => void
}>

export const Tabs = <TValue extends string>({
  label,
  value,
  items,
  onChange,
}: TabsProps<TValue>): React.ReactElement => (
  <div className={styles.tabs} role="tablist" aria-label={label}>
    {items.map((item) => (
      <button
        key={item.value}
        type="button"
        role="tab"
        aria-selected={item.value === value}
        className={item.value === value ? styles.tabActive : styles.tab}
        onClick={() => {
          onChange(item.value)
        }}
      >
        {item.label}
      </button>
    ))}
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
  <div className={styles.presets} role="group" aria-label={label}>
    {options.map((option) => (
      <button
        key={option}
        type="button"
        aria-pressed={option === value}
        className={cx(option === value ? styles.presetActive : styles.preset)}
        onClick={() => {
          onChange(option)
        }}
      >
        {format(option)}
      </button>
    ))}
  </div>
)
