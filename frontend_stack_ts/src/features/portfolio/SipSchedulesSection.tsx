import { Section } from "~/app/layouts/Section"
import { toPaise } from "~/domain/money"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Badge } from "~/ui/primitives/Badge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { ITEM_TITLE } from "~/ui/recipes/datalist"
import { CARD_COLUMNS_WRAP } from "~/ui/recipes/layout"
import { META_TEXT } from "~/ui/recipes/text"

import { POOL_TOP } from "./portfolio.recipe"
import { useSipSchedules } from "./sipScheduleQueries"

export const SipSchedulesSection = (): React.ReactElement | null => {
  const query = useSipSchedules()
  if (query.data?.items.length === 0) return null

  return (
    <Section
      title="Monthly investments"
      description="Your monthly investment plans. Each month counts as paid once the BeOnEdge team records your investment."
    >
      <AsyncBoundary
        query={query}
        skeleton={
          <Card>
            <Skeleton height="0.9rem" width="40%" />
            <Skeleton height="1.6rem" width="60%" />
          </Card>
        }
      >
        {(data) => (
          <div className={CARD_COLUMNS_WRAP[3]}>
            {data.items.map((schedule) => (
              <Card key={schedule.scheduleId}>
                <div className={POOL_TOP}>
                  <span className={ITEM_TITLE}>{schedule.fundName}</span>
                  {schedule.state === "active" ? null : <Badge tone="neutral">Closed</Badge>}
                </div>
                <span>
                  <MoneyValue amount={toPaise(schedule.monthlyAmountPaise)} size="md" /> a month
                </span>
                <span className={META_TEXT}>
                  {`${String(schedule.monthsPaid)} of ${String(schedule.totalMonths)} months paid`}
                </span>
              </Card>
            ))}
          </div>
        )}
      </AsyncBoundary>
    </Section>
  )
}
