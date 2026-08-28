import { MoneyPrecisionError, formatINR, isNegativePaise } from "~/domain/money"
import type { Paise } from "~/domain/money"

import styles from "./MoneyValue.module.css"
import { cx } from "~/lib/cx"

export type MoneySize = "sm" | "md" | "lg" | "xl"
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
  const classes = [styles.money, styles[size]]
  if (tone === "muted") classes.push(styles.muted)
  if (tone === "signed") {
    classes.push(isNegativePaise(amount) ? styles.negative : styles.positive)
  }

  let rendered: string
  try {
    rendered = formatINR(amount, { showDecimals, showSign })
  } catch (error) {
    if (!(error instanceof MoneyPrecisionError)) throw error
    return (
      <span className={cx(styles.money, styles[size], styles.muted)}>
        Amount unavailable
      </span>
    )
  }

  return <span className={classes.join(" ")}>{rendered}</span>
}
