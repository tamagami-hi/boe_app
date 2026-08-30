import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDate, formatMonth } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { useStatements } from "~/features/shared/queries"
import { cx } from "~/lib/cx"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { STAT_LABEL } from "~/ui/recipes/datalist"
import { CARD_COLUMNS, ROW_BETWEEN_BASELINE } from "~/ui/recipes/layout"
import { CARD_STACK } from "~/ui/recipes/surface"
import { META_TEXT, SUBHEAD_TITLE } from "~/ui/recipes/text"

import { STATEMENT_FLOW, STATEMENT_FLOW_LABEL } from "./statements.recipe"

const FLOW_LABEL = cx(STAT_LABEL, STATEMENT_FLOW_LABEL)

const StatementsScreen = (): React.ReactElement => {
  const query = useStatements()

  return (
    <Page width="default">
      <PageHeader
        title="Statements"
        description="Each month is derived by the backend from your append-only ledger. There is nothing to download; this is the record."
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
            title="No statement periods yet"
            description="A month appears here once your ledger has an entry in it."
          />
        }
      >
        {(data) => (
          <div className={cx(CARD_STACK, CARD_COLUMNS[2])}>
            {data.items.map((period) => (
              <Card key={period.id}>
                <div className={ROW_BETWEEN_BASELINE}>
                  <span className={SUBHEAD_TITLE}>{formatMonth(`${period.period}-01`)}</span>
                  <span className={META_TEXT}>
                    {formatDate(period.periodStart)} — {formatDate(period.periodEnd)}
                  </span>
                </div>

                <span className={FLOW_LABEL}>Closing value</span>
                <MoneyValue amount={toPaise(period.closingValuePaise)} size="lg" />

                <div className={STATEMENT_FLOW}>
                  <div>
                    <span className={FLOW_LABEL}>Opening</span>
                    <MoneyValue amount={toPaise(period.openingValuePaise)} size="sm" tone="muted" />
                  </div>
                  <div>
                    <span className={FLOW_LABEL}>Contributions</span>
                    <MoneyValue amount={toPaise(period.contributionsPaise)} size="sm" />
                  </div>
                  <div>
                    <span className={FLOW_LABEL}>Growth</span>
                    <MoneyValue
                      amount={toPaise(period.growthPaise)}
                      size="sm"
                      tone="signed"
                      showSign
                    />
                  </div>
                  <div>
                    <span className={FLOW_LABEL}>Invested to date</span>
                    <MoneyValue amount={toPaise(period.totalInvestmentPaise)} size="sm" />
                  </div>
                </div>

                <span className={META_TEXT}>
                  {period.entryCount === 1
                    ? "1 ledger entry"
                    : `${String(period.entryCount)} ledger entries`}
                  {period.reversalsPaise === "0" ? "" : " · includes a reversal"}
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
