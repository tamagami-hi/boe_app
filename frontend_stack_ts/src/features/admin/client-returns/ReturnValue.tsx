import { formatBasisPoints } from "~/domain/percent"
import { cx } from "~/lib/cx"
import { MONEY_BASE, MONEY_SIZE, MONEY_TONE } from "~/ui/recipes/text"
import type { MoneySize } from "~/ui/recipes/text"

type Props = Readonly<{
  basisPoints: string | null
  size?: MoneySize
}>

const toneOf = (basisPoints: string | null): string => {
  if (basisPoints === null) return MONEY_TONE.muted
  if (basisPoints.startsWith("-")) return MONEY_TONE.negative
  return basisPoints === "0" ? MONEY_TONE.default : MONEY_TONE.positive
}

export const ReturnValue = ({ basisPoints, size = "sm" }: Props): React.ReactElement => (
  <span className={cx(MONEY_BASE, MONEY_SIZE[size], toneOf(basisPoints))}>
    {formatBasisPoints(basisPoints, { showSign: true })}
  </span>
)
