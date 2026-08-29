import { cx } from "~/lib/cx"
import { PRESET_ACTIVE, PRESET_BASE, PRESET_REST, PRESET_ROW, RADIO_ACTIVE, RADIO_BASE, RADIO_GROUP, RADIO_LABEL, RADIO_MARK_ACTIVE, RADIO_MARK_BASE, RADIO_MARK_REST, RADIO_REST, RADIO_TEXT, SWITCH_BASE, SWITCH_HINT, SWITCH_KNOB, SWITCH_KNOB_ON, SWITCH_LABEL, SWITCH_OFF, SWITCH_ON, SWITCH_ROW, SWITCH_TEXT, TABS_ROOT, TAB_ACTIVE, TAB_BASE, TAB_REST } from "~/ui/recipes/field"
import { HINT_MUTED } from "~/ui/recipes/text"

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
      <span className={SWITCH_LABEL}>{label}</span>
      {hint === undefined ? null : <span className={SWITCH_HINT}>{hint}</span>}
    </span>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cx(SWITCH_BASE, checked ? SWITCH_ON : SWITCH_OFF)}
      onClick={() => {
        onChange(!checked)
      }}
    >
      <span className={cx(SWITCH_KNOB, checked ? SWITCH_KNOB_ON : undefined)} />
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
  <div className={RADIO_GROUP} role="radiogroup" aria-label={legend}>
    {options.map((option) => {
      const selected = option.value === value
      return (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={selected}
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
            <span className={RADIO_LABEL}>{option.label}</span>
            {option.hint === undefined ? null : <span className={HINT_MUTED}>{option.hint}</span>}
          </span>
        </button>
      )
    })}
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
  <div className={TABS_ROOT} role="tablist" aria-label={label}>
    {items.map((item) => (
      <button
        key={item.value}
        type="button"
        role="tab"
        aria-selected={item.value === value}
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
