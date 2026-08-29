import { cx } from "~/lib/cx"
import { STACK_LG } from "~/ui/recipes/layout"

import {
  PIN_DOTS,
  PIN_DOT_BASE,
  PIN_DOT_EMPTY,
  PIN_DOT_FILLED,
  PIN_KEY,
  PIN_KEY_WIDE,
  PIN_PAD,
  PIN_PROMPT,
} from "./device-security.recipe"
import { MAX_PIN_LENGTH } from "./securityStore"

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
    <div className={STACK_LG}>
      <span className={PIN_PROMPT}>{prompt}</span>

      <div className={PIN_DOTS} role="img" aria-label={`${String(value.length)} digits entered`}>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <span
            key={index}
            className={cx(PIN_DOT_BASE, index < value.length ? PIN_DOT_FILLED : PIN_DOT_EMPTY)}
          />
        ))}
      </div>

      <div className={PIN_PAD}>
        {KEYS.map((digit) => (
          <button
            key={digit}
            type="button"
            className={PIN_KEY}
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
          className={PIN_KEY_WIDE}
          onClick={() => {
            onChange("")
          }}
        >
          Clear
        </button>
        <button
          type="button"
          className={PIN_KEY}
          aria-label="0"
          onClick={() => {
            press("0")
          }}
        >
          0
        </button>
        <button
          type="button"
          className={PIN_KEY_WIDE}
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
