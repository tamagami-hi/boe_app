import { cx } from "~/lib/cx"

import styles from "./Controls.module.css"

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
  <span className={styles.amountWrap}>
    <span className={styles.amountSymbol} aria-hidden="true">
      ₹
    </span>
    <input
      id={id}
      className={cx(styles.amountInput, invalid && styles.amountInvalid)}
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
