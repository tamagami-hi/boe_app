import { Link, useSearchParams } from "react-router-dom"

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
import { FEED_MEASURE } from "~/ui/recipes/layout"
import { CARD_STACK } from "~/ui/recipes/surface"
import { LINK_TEXT, META_MUTED } from "~/ui/recipes/text"

import { POOL_META, POOL_TOP } from "./portfolio.recipe"
import { useValueUpdates } from "./valueUpdateQueries"

const ValueUpdatesScreen = (): React.ReactElement => {
  const [params] = useSearchParams()
  const highlighted = params.get("entry")
  const query = useValueUpdates()
  const portfolio = usePortfolio()

  return (
    <Page width="default">
      <PageHeader
        title="Value updates"
        description="Each time BeOnEdge updates the value of one of your investments, it is recorded here."
      />

      <AsyncBoundary
        query={query}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="45%" />
            <Skeleton height="1rem" width="70%" />
          </Card>
        }
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            title="No value updates yet"
            description="When the value of your investment is updated, the change appears here."
          />
        }
      >
        {(data) => (
          <div className={cx(CARD_STACK, FEED_MEASURE)}>
            {data.items.map((update) => (
              <Card key={update.entryId} tone={update.entryId === highlighted ? "elevated" : "default"}>
                <div className={POOL_TOP}>
                  <Link to={`/funds/${update.fundId}`} className={LINK_TEXT}>
                    {update.fundName}
                  </Link>
                  <MoneyValue amount={toPaise(update.changePaise)} size="md" tone="signed" showSign />
                </div>
                <div className={cx(POOL_META, META_MUTED)}>
                  <span>Date</span>
                  <span>{formatDate(`${update.date}T00:00:00Z`)}</span>
                  <span>Value after this update</span>
                  <MoneyValue amount={toPaise(update.valueAfterPaise)} size="sm" tone="muted" />
                </div>
                {update.entryId === highlighted ? <Badge tone="info">From your notification</Badge> : null}
              </Card>
            ))}
          </div>
        )}
      </AsyncBoundary>
      <LoadMore list={query} noun="updates" />

      <MoneyFootnote lastUpdated={portfolio.data?.lastUpdated ?? null} />
    </Page>
  )
}

export default ValueUpdatesScreen
