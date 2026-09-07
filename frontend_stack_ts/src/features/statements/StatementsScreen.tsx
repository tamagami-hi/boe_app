import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDate, formatMonth } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { countOf } from "~/domain/plural"
import { useStatements } from "~/features/shared/queries"
import { cx } from "~/lib/cx"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { STAT_LABEL, STAT_ROOT, SUMMARY_GRID } from "~/ui/recipes/datalist"
import { CARD_COLUMNS, ROW_BETWEEN_BASELINE } from "~/ui/recipes/layout"
import { CARD_STACK } from "~/ui/recipes/surface"
import { CARD_TITLE, META_TEXT } from "~/ui/recipes/text"

const StatementsScreen = (): React.ReactElement => {
  const query = useStatements()

  return (
    <Page width="default">
      <PageHeader
        title="Statements"
        description="A month-by-month record of your investments and their value."
      />

      <AsyncBoundary
        query={query}
        skeleton={
          <div className={cx(CARD_STACK, CARD_COLUMNS[2])}>
            {[0, 1].map((index) => (
              <Card key={index}>
                <Skeleton height="1.2rem" width="35%" />
                <Skeleton height="2.4rem" />
              </Card>
            ))}
          </div>
        }
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            title="No statements yet"
            description="Your first statement appears once you have invested."
          />
        }
      >
        {(data) => (
          <div className={cx(CARD_STACK, CARD_COLUMNS[2])}>
            {data.items.map((period) => (
              <Card key={period.id}>
                <div className={ROW_BETWEEN_BASELINE}>
                  <span className={CARD_TITLE}>{formatMonth(`${period.period}-01`)}</span>
                  <span className={META_TEXT}>
                    {formatDate(period.periodStart)} — {formatDate(period.periodEnd)}
                  </span>
                </div>

                <div className={STAT_ROOT}>
                  <span className={STAT_LABEL}>Closing value</span>
                  <MoneyValue amount={toPaise(period.closingValuePaise)} size="lg" />
                </div>

                <div className={SUMMARY_GRID}>
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Opening</span>
                    <MoneyValue amount={toPaise(period.openingValuePaise)} size="sm" tone="muted" />
                  </div>
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Contributions</span>
                    <MoneyValue amount={toPaise(period.contributionsPaise)} size="sm" />
                  </div>
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Growth</span>
                    <MoneyValue
                      amount={toPaise(period.growthPaise)}
                      size="sm"
                      tone="signed"
                      showSign
                    />
                  </div>
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Invested to date</span>
                    <MoneyValue amount={toPaise(period.totalInvestmentPaise)} size="sm" />
                  </div>
                </div>

                <span className={META_TEXT}>
                  {period.entryCount === 1
                    ? "1 entry"
                    : countOf(period.entryCount, "entry", "entries")}
                  {period.reversalsPaise === "0" ? "" : " · includes a correction"}
                </span>
              </Card>
            ))}
          </div>
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default StatementsScreen
