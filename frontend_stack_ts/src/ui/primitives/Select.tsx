import type { SelectHTMLAttributes } from "react"

import { cx } from "~/lib/cx"

import styles from "./Controls.module.css"

export type SelectOption = Readonly<{ value: string; label: string; disabled?: boolean }>

export type SelectProps = Readonly<{
  options: readonly SelectOption[]
  invalid?: boolean
}> &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "children">

export const Select = ({ options, invalid = false, ...rest }: SelectProps): React.ReactElement => (
  <select {...rest} className={cx(styles.select)} aria-invalid={invalid}>
    {options.map((option) => (
      <option key={option.value} value={option.value} disabled={option.disabled === true}>
        {option.label}
      </option>
    ))}
  </select>
)
