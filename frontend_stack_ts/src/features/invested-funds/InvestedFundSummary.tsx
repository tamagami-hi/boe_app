import { toPaise } from "~/domain/money"
import { countOf } from "~/domain/plural"
import { formatPercent } from "~/domain/percent"
import { usePortfolio } from "~/features/shared/queries"
import { cx } from "~/lib/cx"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { STAT_LABEL, STAT_ROOT, SUMMARY_GRID } from "~/ui/recipes/datalist"
import { META_TEXT, MONEY_BASE, MONEY_SIZE, MONEY_TONE } from "~/ui/recipes/text"

export type InvestedFundSummaryProps = Readonly<{ fundId: string }>

export const InvestedFundSummary = ({ fundId }: InvestedFundSummaryProps): React.ReactElement => {
  const portfolio = usePortfolio()

  return (
    <AsyncBoundary
      query={portfolio}
      skeleton={
        <Card>
          <Skeleton height="0.9rem" width="30%" />
          <Skeleton height="2.4rem" width="55%" />
        </Card>
      }
    >
      {(data) => {
        const pool = data.pools.find((candidate) => candidate.fundId === fundId)
        if (pool === undefined) {
          return (
            <Card>
              <span className={META_TEXT}>This investment has no value recorded yet.</span>
            </Card>
          )
        }
        return (
          <Card elevated>
            <span className={STAT_LABEL}>Current value</span>
            <MoneyValue amount={toPaise(pool.currentValuePaise)} size="xl" />
            <div className={SUMMARY_GRID}>
              <div className={STAT_ROOT}>
                <span className={STAT_LABEL}>Invested</span>
                <MoneyValue amount={toPaise(pool.totalInvestmentPaise)} size="md" />
              </div>
              <div className={STAT_ROOT}>
                <span className={STAT_LABEL}>Growth</span>
                <MoneyValue amount={toPaise(pool.totalGrowthPaise)} size="md" tone="signed" showSign />
              </div>
              <div className={STAT_ROOT}>
                <span className={STAT_LABEL}>Return</span>
                <span className={cx(MONEY_BASE, MONEY_SIZE.md, MONEY_TONE.default)}>
                  {formatPercent(pool.returnPercent, { showSign: true })}
                </span>
              </div>
            </div>
            <span className={META_TEXT}>{countOf(pool.contributionCount, "payment")}</span>
          </Card>
        )
      }}
    </AsyncBoundary>
  )
}
