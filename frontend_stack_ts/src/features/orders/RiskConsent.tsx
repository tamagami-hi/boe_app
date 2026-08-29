import { cx } from "~/lib/cx"
import {
  CHECKBOX_GLYPH,
  CHECKBOX_MARK_BASE,
  CHECKBOX_MARK_OFF,
  CHECKBOX_MARK_ON,
  CHECKBOX_ROW,
} from "~/ui/recipes/field"
import { BODY_SM } from "~/ui/recipes/text"

export type RiskConsentProps = Readonly<{
  checked: boolean
  onChange: (next: boolean) => void
}>

export const RiskConsent = ({ checked, onChange }: RiskConsentProps): React.ReactElement => (
  <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    className={CHECKBOX_ROW}
    onClick={() => {
      onChange(!checked)
    }}
  >
    <span
      className={cx(CHECKBOX_MARK_BASE, checked ? CHECKBOX_MARK_ON : CHECKBOX_MARK_OFF)}
      aria-hidden="true"
    >
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
    <span className={BODY_SM}>
      I understand this is a market-linked investment, that the value can fall as well as rise, and
      that BeOnEdge does not guarantee a return.
    </span>
  </button>
)
