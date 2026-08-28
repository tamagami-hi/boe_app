import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDate, formatMonth } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { useStatements } from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

import styles from "./Statements.module.css"

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
          <div className={styles.list}>
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
          <div className={styles.list}>
            {data.items.map((period) => (
              <Card key={period.id}>
                <div className={styles.top}>
                  <span className={styles.period}>{formatMonth(`${period.period}-01`)}</span>
                  <span className={styles.range}>
                    {formatDate(period.periodStart)} — {formatDate(period.periodEnd)}
                  </span>
                </div>

                <span className={styles.label}>Closing value</span>
                <MoneyValue amount={toPaise(period.closingValuePaise)} size="lg" />

                <div className={styles.flow}>
                  <div>
                    <span className={styles.label}>Opening</span>
                    <MoneyValue amount={toPaise(period.openingValuePaise)} size="sm" tone="muted" />
                  </div>
                  <div>
                    <span className={styles.label}>Contributions</span>
                    <MoneyValue amount={toPaise(period.contributionsPaise)} size="sm" />
                  </div>
                  <div>
                    <span className={styles.label}>Growth</span>
                    <MoneyValue
                      amount={toPaise(period.growthPaise)}
                      size="sm"
                      tone="signed"
                      showSign
                    />
                  </div>
                  <div>
                    <span className={styles.label}>Invested to date</span>
                    <MoneyValue amount={toPaise(period.totalInvestmentPaise)} size="sm" />
                  </div>
                </div>

                <span className={styles.footer}>
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
