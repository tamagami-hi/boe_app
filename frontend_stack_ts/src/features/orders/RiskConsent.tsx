import styles from "./Orders.module.css"

export type RiskConsentProps = Readonly<{
  checked: boolean
  onChange: (next: boolean) => void
}>

export const RiskConsent = ({ checked, onChange }: RiskConsentProps): React.ReactElement => (
  <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    className={styles.consent}
    onClick={() => {
      onChange(!checked)
    }}
  >
    <span className={checked ? styles.consentBoxOn : styles.consentBox} aria-hidden="true">
      {checked ? (
        <svg
          className={styles.consentGlyph}
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
    <span className={styles.consentText}>
      I understand this is a market-linked investment, that the value can fall as well as rise, and
      that BeOnEdge does not guarantee a return.
    </span>
  </button>
)
