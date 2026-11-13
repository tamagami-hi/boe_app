import { formatDate } from "~/domain/dates"
import { META_TEXT } from "~/ui/recipes/text"

export type MoneyFootnoteProps = Readonly<{
  lastUpdated: string | null
}>

const SOURCE = "Values recorded by BeOnEdge"

const MARKET_RISK = "Investments are subject to market risk."

const SEPARATOR = " · "

export const MoneyFootnote = ({ lastUpdated }: MoneyFootnoteProps): React.ReactElement => {
  const freshness =
    lastUpdated === null ? [] : [`Last updated ${formatDate(`${lastUpdated}T00:00:00Z`)}`]
  return <p className={META_TEXT}>{[SOURCE, ...freshness, MARKET_RISK].join(SEPARATOR)}</p>
}
