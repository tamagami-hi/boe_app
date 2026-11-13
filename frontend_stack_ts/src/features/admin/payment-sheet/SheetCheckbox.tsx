import { cx } from "~/lib/cx"
import { CHECKBOX_GLYPH, CHECKBOX_MARK_BASE, CHECKBOX_MARK_OFF, CHECKBOX_MARK_ON, SWITCH_HIT } from "~/ui/recipes/field"

export type SheetCheckboxProps = Readonly<{
  label: string
  checked: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}>

export const SheetCheckbox = ({ label, checked, disabled, onChange }: SheetCheckboxProps): React.ReactElement => (
  <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    className={SWITCH_HIT}
    onClick={() => {
      onChange(!checked)
    }}
  >
    <span className={cx(CHECKBOX_MARK_BASE, checked ? CHECKBOX_MARK_ON : CHECKBOX_MARK_OFF)} aria-hidden="true">
      {checked ? (
        <svg
          className={CHECKBOX_GLYPH}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 6.3 4.7 8.5 9.5 3.7" />
        </svg>
      ) : null}
    </span>
  </button>
)
