import { MoneyPrecisionError, formatINR, isNegativePaise } from "~/domain/money"
import type { Paise } from "~/domain/money"

import { cx } from "~/lib/cx"
import { MONEY_BASE, MONEY_SIZE, MONEY_TONE } from "~/ui/recipes/text"
import type { MoneySize } from "~/ui/recipes/text"

export type { MoneySize }
export type MoneyTone = "default" | "signed" | "muted"

export type MoneyValueProps = Readonly<{
  amount: Paise
  size?: MoneySize
  tone?: MoneyTone
  showDecimals?: boolean
  showSign?: boolean
}>

export const MoneyValue = ({
  amount,
  size = "md",
  tone = "default",
  showDecimals = false,
  showSign = false,
}: MoneyValueProps): React.ReactElement => {
  const toneClass =
    tone === "muted"
      ? MONEY_TONE.muted
      : tone === "signed"
        ? isNegativePaise(amount)
          ? MONEY_TONE.negative
          : MONEY_TONE.positive
        : MONEY_TONE.default

  let rendered: string
  try {
    rendered = formatINR(amount, { showDecimals, showSign })
  } catch (error) {
    if (!(error instanceof MoneyPrecisionError)) throw error
    return (
      <span className={cx(MONEY_BASE, MONEY_SIZE[size], MONEY_TONE.muted)}>
        Amount unavailable
      </span>
    )
  }

  return <span className={cx(MONEY_BASE, MONEY_SIZE[size], toneClass)}>{rendered}</span>
}
