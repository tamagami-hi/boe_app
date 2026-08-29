import { cx } from "~/lib/cx"
import { AMOUNT_INPUT, AMOUNT_INVALID, AMOUNT_SYMBOL, AMOUNT_WRAP } from "~/ui/recipes/field"

export type AmountInputProps = Readonly<{
  id?: string
  value: string
  invalid?: boolean
  describedBy?: string
  disabled?: boolean
  onChange: (next: string) => void
}>

const DIGITS_ONLY = /[^0-9]/gu

export const AmountInput = ({
  id,
  value,
  invalid = false,
  describedBy,
  disabled = false,
  onChange,
}: AmountInputProps): React.ReactElement => (
  <span className={AMOUNT_WRAP}>
    <span className={AMOUNT_SYMBOL} aria-hidden="true">
      ₹
    </span>
    <input
      id={id}
      className={cx(AMOUNT_INPUT, invalid ? AMOUNT_INVALID : undefined)}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      value={value}
      disabled={disabled}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      onChange={(event) => {
        onChange(event.target.value.replace(DIGITS_ONLY, ""))
      }}
    />
  </span>
)
