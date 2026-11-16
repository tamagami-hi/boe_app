import { Section } from "~/app/layouts/Section"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { EARLY_EXIT_LABEL, useSipEarlyExits } from "~/features/portfolio/sipEarlyExitQueries"
import { cx } from "~/lib/cx"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Badge } from "~/ui/primitives/Badge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { ITEM_TITLE } from "~/ui/recipes/datalist"
import { FEED_MEASURE } from "~/ui/recipes/layout"
import { CARD_STACK } from "~/ui/recipes/surface"
import { META_MUTED } from "~/ui/recipes/text"

import { ROW, ROW_LEFT, ROW_RIGHT } from "~/features/activity/activity.recipe"

export const EarlyExitReceipts = (): React.ReactElement | null => {
  const exits = useSipEarlyExits()
  if (exits.data?.items.length === 0) return null

  return (
    <Section
      title="Early exits"
      description="Monthly investment plans closed before their last month. The full value of your holding in that fund was withdrawn to be returned to you."
    >
      <AsyncBoundary
        query={exits}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="45%" />
            <Skeleton height="1rem" width="70%" />
          </Card>
        }
      >
        {(data) => (
          <div className={cx(CARD_STACK, FEED_MEASURE)}>
            {data.items.map((exit) => (
              <Card key={exit.earlyExitId}>
                <div className={ROW}>
                  <div className={ROW_LEFT}>
                    <Badge tone="neutral">{EARLY_EXIT_LABEL}</Badge>
                    <span className={ITEM_TITLE}>{exit.fundName}</span>
                    <span className={META_MUTED}>{formatDate(`${exit.effectiveDate}T00:00:00Z`)}</span>
                  </div>
                  <div className={ROW_RIGHT}>
                    <MoneyValue amount={toPaise(exit.amountPaise)} size="md" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </AsyncBoundary>
    </Section>
  )
}
