import { cx } from "~/lib/cx"
import { AMOUNT_INPUT, AMOUNT_SYMBOL, AMOUNT_WRAP, FIELD_INVALID } from "~/ui/recipes/field"

export type AmountInputProps = Readonly<{
  id?: string
  value: string
  invalid?: boolean
  describedBy?: string | undefined
  disabled?: boolean
  decimals?: boolean
  onChange: (next: string) => void
}>

const DIGITS_ONLY = /[^0-9]/gu
const DIGITS_AND_POINT = /[^0-9.]/gu

export const AmountInput = ({
  id,
  value,
  invalid = false,
  describedBy,
  disabled = false,
  decimals = false,
  onChange,
}: AmountInputProps): React.ReactElement => (
  <span className={AMOUNT_WRAP}>
    <span className={AMOUNT_SYMBOL} aria-hidden="true">
      ₹
    </span>
    <input
      id={id}
      className={cx(AMOUNT_INPUT, invalid ? FIELD_INVALID : undefined)}
      type="text"
      inputMode={decimals ? "decimal" : "numeric"}
      autoComplete="off"
      spellCheck={false}
      value={value}
      disabled={disabled}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      onChange={(event) => {
        onChange(event.target.value.replace(decimals ? DIGITS_AND_POINT : DIGITS_ONLY, ""))
      }}
    />
  </span>
)
