import { Link } from "react-router-dom"

import { Section } from "~/app/layouts/Section"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { ROW, ROW_LEFT, ROW_RIGHT } from "~/features/activity/activity.recipe"
import { cx } from "~/lib/cx"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Badge } from "~/ui/primitives/Badge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { FEED_MEASURE } from "~/ui/recipes/layout"
import { CARD_LINK, CARD_STACK } from "~/ui/recipes/surface"
import { META_MUTED } from "~/ui/recipes/text"

import { useFundReceipts } from "./investedFundQueries"

export type FundReceiptListProps = Readonly<{ fundId: string }>

export const FundReceiptList = ({ fundId }: FundReceiptListProps): React.ReactElement => {
  const receipts = useFundReceipts(fundId)

  return (
    <Section title="Recorded investments" description="Investments the BeOnEdge team recorded in this fund for you.">
      <AsyncBoundary
        query={receipts}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="45%" />
            <Skeleton height="1rem" width="70%" />
          </Card>
        }
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            title="No recorded investments"
            description="When the BeOnEdge team records an investment in this fund for you, it appears here."
          />
        }
      >
        {(data) => (
          <div className={cx(CARD_STACK, FEED_MEASURE)}>
            {data.items.map((receipt) => (
              <Link key={receipt.entryId} to={`/activity/receipts/${receipt.entryId}`} className={CARD_LINK}>
                <Card>
                  <div className={ROW}>
                    <div className={ROW_LEFT}>
                      <Badge tone="info">{receipt.categoryLabel}</Badge>
                      <span className={META_MUTED}>{formatDate(`${receipt.effectiveDate}T00:00:00Z`)}</span>
                      {receipt.reversedAt === null ? null : <Badge tone="neutral">Reversed</Badge>}
                    </div>
                    <div className={ROW_RIGHT}>
                      <MoneyValue amount={toPaise(receipt.amountPaise)} size="md" />
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </AsyncBoundary>
      <LoadMore list={receipts} noun="investments" />
    </Section>
  )
}
