import type { SelectHTMLAttributes } from "react"

import { SELECT_BASE } from "~/ui/recipes/field"

export type SelectOption = Readonly<{ value: string; label: string; disabled?: boolean }>

export type SelectProps = Readonly<{
  options: readonly SelectOption[]
  invalid?: boolean
}> &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "children">

export const Select = ({ options, invalid = false, ...rest }: SelectProps): React.ReactElement => (
  <select {...rest} className={SELECT_BASE} aria-invalid={invalid}>
    {options.map((option) => (
      <option key={option.value} value={option.value} disabled={option.disabled === true}>
        {option.label}
      </option>
    ))}
  </select>
)
