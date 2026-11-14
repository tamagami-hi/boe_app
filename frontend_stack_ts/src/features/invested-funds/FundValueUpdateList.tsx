import { Section } from "~/app/layouts/Section"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { POOL_META, POOL_TOP } from "~/features/portfolio/portfolio.recipe"
import { cx } from "~/lib/cx"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { FEED_MEASURE } from "~/ui/recipes/layout"
import { CARD_STACK } from "~/ui/recipes/surface"
import { META_MUTED } from "~/ui/recipes/text"

import { useFundValueUpdates } from "./investedFundQueries"

export type FundValueUpdateListProps = Readonly<{ fundId: string }>

export const FundValueUpdateList = ({ fundId }: FundValueUpdateListProps): React.ReactElement => {
  const updates = useFundValueUpdates(fundId)

  return (
    <Section title="Value updates" description="Each time BeOnEdge updates the value of this investment.">
      <AsyncBoundary
        query={updates}
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
            description="When the value of this investment is updated, the change appears here."
          />
        }
      >
        {(data) => (
          <div className={cx(CARD_STACK, FEED_MEASURE)}>
            {data.items.map((update) => (
              <Card key={update.entryId}>
                <div className={POOL_TOP}>
                  <span className={META_MUTED}>{formatDate(`${update.date}T00:00:00Z`)}</span>
                  <MoneyValue amount={toPaise(update.changePaise)} size="md" tone="signed" showSign />
                </div>
                <div className={cx(POOL_META, META_MUTED)}>
                  <span>Value after this update</span>
                  <MoneyValue amount={toPaise(update.valueAfterPaise)} size="sm" tone="muted" />
                </div>
              </Card>
            ))}
          </div>
        )}
      </AsyncBoundary>
      <LoadMore list={updates} noun="updates" />
    </Section>
  )
}
