import { formatDate } from "~/domain/dates"
import { HINT_MUTED } from "~/ui/recipes/text"

export type MoneyFootnoteProps = Readonly<{
  lastUpdated: string | null
}>

const SOURCE = "Values recorded by BeOnEdge"

const MARKET_RISK = "Investments are subject to market risk."

const SEPARATOR = " · "

export const MoneyFootnote = ({ lastUpdated }: MoneyFootnoteProps): React.ReactElement => {
  const freshness =
    lastUpdated === null ? [] : [`Last updated ${formatDate(`${lastUpdated}T00:00:00Z`)}`]
  return <p className={HINT_MUTED}>{[SOURCE, ...freshness, MARKET_RISK].join(SEPARATOR)}</p>
}
