import { Section } from "~/app/layouts/Section"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { InlineReadFailure } from "~/features/shared/InlineReadFailure"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Badge } from "~/ui/primitives/Badge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { ITEM_TITLE } from "~/ui/recipes/datalist"
import { CARD_COLUMNS_WRAP } from "~/ui/recipes/layout"
import { META_TEXT } from "~/ui/recipes/text"

import { POOL_TOP } from "./portfolio.recipe"
import { useSipEarlyExits } from "./sipEarlyExitQueries"
import { useSipSchedules } from "./sipScheduleQueries"

const ClosedNote = ({ closedEarlyOn }: Readonly<{ closedEarlyOn: string | undefined }>): React.ReactElement =>
  closedEarlyOn === undefined ? (
    <Badge tone="neutral">Closed</Badge>
  ) : (
    <Badge tone="neutral">{`Closed early on ${formatDate(`${closedEarlyOn}T00:00:00Z`)}`}</Badge>
  )

export const SipSchedulesSection = (): React.ReactElement | null => {
  const query = useSipSchedules()
  const earlyExits = useSipEarlyExits()
  if (query.data?.items.length === 0) return null
  const closedEarlyOn = new Map((earlyExits.data?.items ?? []).map((exit) => [exit.scheduleId, exit.effectiveDate]))

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
          <>
            {earlyExits.isError && data.items.some((schedule) => schedule.state !== "active") ? (
              <InlineReadFailure
                label="Couldn’t check which closed plans were closed early"
                retrying={earlyExits.isFetching}
                onRetry={() => {
                  void earlyExits.refetch()
                }}
              />
            ) : null}
            <div className={CARD_COLUMNS_WRAP[3]}>
              {data.items.map((schedule) => (
                <Card key={schedule.scheduleId}>
                  <div className={POOL_TOP}>
                    <span className={ITEM_TITLE}>{schedule.fundName}</span>
                    {schedule.state === "active" ? null : <ClosedNote closedEarlyOn={closedEarlyOn.get(schedule.scheduleId)} />}
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
          </>
        )}
      </AsyncBoundary>
    </Section>
  )
}
