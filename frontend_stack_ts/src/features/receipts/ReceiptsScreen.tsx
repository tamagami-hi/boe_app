import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { usePortfolio } from "~/features/shared/queries"
import { cx } from "~/lib/cx"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { MoneyFootnote } from "~/ui/patterns/MoneyFootnote"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Badge } from "~/ui/primitives/Badge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { ITEM_TITLE } from "~/ui/recipes/datalist"
import { FEED_MEASURE } from "~/ui/recipes/layout"
import { CARD_LINK, CARD_STACK } from "~/ui/recipes/surface"
import { META_MUTED } from "~/ui/recipes/text"

import { ROW, ROW_LEFT, ROW_RIGHT } from "~/features/activity/activity.recipe"

import { EarlyExitReceipts } from "./EarlyExitReceipts"
import { useReceipts } from "./receiptQueries"

const ReceiptsScreen = (): React.ReactElement => {
  const receipts = useReceipts()
  const portfolio = usePortfolio()

  return (
    <Page width="default">
      <PageHeader
        title="Receipts"
        description="Every investment the BeOnEdge team recorded for you, labelled with its category."
      />

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
            title="No receipts yet"
            description="When the BeOnEdge team records an investment for you, its receipt appears here."
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
                      <span className={ITEM_TITLE}>{receipt.fundName}</span>
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
      <LoadMore list={receipts} noun="receipts" />

      <EarlyExitReceipts />

      <MoneyFootnote lastUpdated={portfolio.data?.lastUpdated ?? null} />
    </Page>
  )
}

export default ReceiptsScreen
