import { formatPercent } from "~/domain/percent"
import { colourFor } from "~/ui/charts/chartMath"
import { Card } from "~/ui/primitives/Card"
import { LEGEND_LABEL, LEGEND_ROW, LEGEND_SWATCH, LEGEND_VALUE } from "~/ui/recipes/chart"
import { STACK_LG } from "~/ui/recipes/layout"
import { META_MUTED } from "~/ui/recipes/text"

interface DisclosedStock {
  readonly stockName: string
  readonly quarterLabel: string
  readonly weightPercent: string | null
}

const FULL_PERCENT = 100
const UNDISCLOSED_COLOUR = "var(--be-hairline)"
const PIE_SIZE = "mx-auto aspect-square w-full max-w-64 rounded-full"

const quarterOrder = (label: string): number => {
  const match = /^Q([1-4]) FY([0-9]{2})$/u.exec(label)
  return match === null ? 0 : Number(match[2]) * 4 + Number(match[1])
}

const QuarterAllocation = ({ quarter, stocks }: Readonly<{
  quarter: string
  stocks: readonly DisclosedStock[]
}>): React.ReactElement => {
  const weights = stocks.map((stock) => stock.weightPercent === null ? 0 : Number(stock.weightPercent))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const scale = Math.max(FULL_PERCENT, total)
  const segments = weights.reduce<Readonly<{ cursor: number; stops: readonly string[] }>>((acc, weight, index) => {
    const end = acc.cursor + weight / scale * FULL_PERCENT
    return { cursor: end, stops: [...acc.stops, `${colourFor(index)} ${String(acc.cursor)}% ${String(end)}%`] }
  }, { cursor: 0, stops: [] })
  const remainder = Math.max(FULL_PERCENT - total, 0)
  const background = total === 0 ? UNDISCLOSED_COLOUR
    : `conic-gradient(${[...segments.stops, `${UNDISCLOSED_COLOUR} ${String(segments.cursor)}% 100%`].join(", ")})`
  const description = stocks.map((stock) => `${stock.stockName}: ${stock.weightPercent === null ? "weight not disclosed" : formatPercent(Number(stock.weightPercent))}`).join(", ")

  return (
    <Card>
      <div className={STACK_LG}>
        <h3>{quarter}</h3>
        <div className={PIE_SIZE} style={{ background }} role="img" aria-label={`Fund allocation for ${quarter}. ${description}${total > 0 && remainder > 0 ? `. Weight not disclosed: ${formatPercent(remainder)}` : ""}`} />
        {total === 0 ? <p className={META_MUTED}>Allocation weights have not been disclosed, so the chart shows no estimated stock weights.</p> : null}
        {total > FULL_PERCENT ? <p className={META_MUTED}>Disclosed weights total more than 100%. Slice sizes show their relative proportions; the published weights are listed below.</p> : null}
        <ul className="m-0 flex list-none flex-col p-0" aria-label={`Held stocks for ${quarter}`}>
          {stocks.map((stock, index) => (
            <li key={stock.stockName} className={LEGEND_ROW}>
              <span className={LEGEND_SWATCH} style={{ background: stock.weightPercent === null ? UNDISCLOSED_COLOUR : colourFor(index) }} aria-hidden="true" />
              <span className={LEGEND_LABEL}>{stock.stockName}</span>
              <span className={LEGEND_VALUE}>{stock.weightPercent === null ? "Not disclosed" : formatPercent(Number(stock.weightPercent))}</span>
            </li>
          ))}
          {total > 0 && remainder > 0 ? (
            <li className={LEGEND_ROW}>
              <span className={LEGEND_SWATCH} style={{ background: UNDISCLOSED_COLOUR }} aria-hidden="true" />
              <span className={LEGEND_LABEL}>Weight not disclosed</span>
              <span className={LEGEND_VALUE}>{formatPercent(remainder)}</span>
            </li>
          ) : null}
        </ul>
      </div>
    </Card>
  )
}

export const FundStockAllocation = ({ stocks }: Readonly<{ stocks: readonly DisclosedStock[] }>): React.ReactElement => {
  const quarters = [...new Set(stocks.map((stock) => stock.quarterLabel))].sort((left, right) => quarterOrder(right) - quarterOrder(left))
  return (
    <div className={STACK_LG}>
      {quarters.map((quarter) => <QuarterAllocation key={quarter} quarter={quarter} stocks={stocks.filter((stock) => stock.quarterLabel === quarter)} />)}
    </div>
  )
}
