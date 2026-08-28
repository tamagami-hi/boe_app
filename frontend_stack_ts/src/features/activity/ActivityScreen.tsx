import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { useFunds, useTransactions } from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Badge } from "~/ui/primitives/Badge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

import styles from "./Activity.module.css"

const LABEL = {
  lump_sum: "Lump sum",
  sip_installment: "SIP installment",
  gain_allocation: "Growth",
  adjustment: "Adjustment",
} as const

const TONE = {
  lump_sum: "info",
  sip_installment: "info",
  gain_allocation: "positive",
  adjustment: "neutral",
} as const

const ActivityScreen = (): React.ReactElement => {
  const query = useTransactions()
  const funds = useFunds()

  const nameFor = (fundId: string): string =>
    funds.data?.items.find((fund) => fund.id === fundId)?.name ?? "Fund"

  return (
    <Page width="default">
      <PageHeader
        title="Activity"
        description="Every movement in your value ledger, newest first."
      />

      <AsyncBoundary
        query={query}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="45%" />
            <Skeleton height="1rem" width="70%" />
            <Skeleton height="1rem" width="60%" />
          </Card>
        }
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            title="Nothing has happened yet"
            description="Contributions, growth adjustments and corrections all appear here once they settle."
            action={
              <Link to="/funds">
                <Button>Browse funds</Button>
              </Link>
            }
          />
        }
      >
        {(data) => (
          <div className={styles.list}>
            {[...data.items]
              .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
              .map((entry) => (
                <Card key={entry.id}>
                  <div className={styles.row}>
                    <div className={styles.left}>
                      <Badge tone={TONE[entry.type]}>{LABEL[entry.type]}</Badge>
                      <Link to={`/funds/${entry.fundId}`} className={styles.fundLink}>
                        {nameFor(entry.fundId)}
                      </Link>
                      <span className={styles.date}>
                        {formatDate(`${entry.date}T00:00:00Z`)}
                      </span>
                    </div>
                    <div className={styles.right}>
                      <MoneyValue
                        amount={toPaise(entry.valueDeltaPaise)}
                        size="md"
                        tone="signed"
                        showSign
                      />
                      <span className={styles.sub}>value change</span>
                    </div>
                  </div>
                </Card>
              ))}
          </div>
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default ActivityScreen
