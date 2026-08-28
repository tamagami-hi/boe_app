import { MAX_PIN_LENGTH } from "./securityStore"

import styles from "./DeviceSecurity.module.css"

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const

export type PinPadProps = Readonly<{
  prompt: string
  value: string
  onChange: (next: string) => void
}>

export const PinPad = ({ prompt, value, onChange }: PinPadProps): React.ReactElement => {
  const press = (digit: string): void => {
    if (value.length >= MAX_PIN_LENGTH) return
    onChange(value + digit)
  }

  return (
    <div className={styles.stack}>
      <span className={styles.prompt}>{prompt}</span>

      <div className={styles.dots} role="img" aria-label={`${String(value.length)} digits entered`}>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <span key={index} className={index < value.length ? styles.dotFilled : styles.dot} />
        ))}
      </div>

      <div className={styles.pad}>
        {KEYS.map((digit) => (
          <button
            key={digit}
            type="button"
            className={styles.key}
            aria-label={digit}
            onClick={() => {
              press(digit)
            }}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          className={styles.keyWide}
          onClick={() => {
            onChange("")
          }}
        >
          Clear
        </button>
        <button
          type="button"
          className={styles.key}
          aria-label="0"
          onClick={() => {
            press("0")
          }}
        >
          0
        </button>
        <button
          type="button"
          className={styles.keyWide}
          aria-label="Delete the last digit"
          onClick={() => {
            onChange(value.slice(0, -1))
          }}
        >
          Delete
        </button>
      </div>
    </div>
  )
}
