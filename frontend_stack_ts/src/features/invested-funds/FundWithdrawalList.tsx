import { Section } from "~/app/layouts/Section"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { ROW, ROW_LEFT, ROW_RIGHT } from "~/features/activity/activity.recipe"
import { EARLY_EXIT_LABEL, useSipEarlyExits } from "~/features/portfolio/sipEarlyExitQueries"
import { InlineReadFailure } from "~/features/shared/InlineReadFailure"
import { usePortfolio } from "~/features/shared/queries"
import { cx } from "~/lib/cx"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Badge } from "~/ui/primitives/Badge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { FEED_MEASURE } from "~/ui/recipes/layout"
import { CARD_STACK } from "~/ui/recipes/surface"
import { META_MUTED } from "~/ui/recipes/text"

import { useWholeLedger } from "./investedFundQueries"

const WITHDRAWAL_LABEL = "Withdrawal"

type DatedEntry = Readonly<{ date: string; createdAt: string }>

const newestFirst = (left: DatedEntry, right: DatedEntry): number =>
  right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt)

const listSkeleton = (
  <Card>
    <Skeleton height="1rem" width="45%" />
    <Skeleton height="1rem" width="70%" />
  </Card>
)

export type FundWithdrawalListProps = Readonly<{ fundId: string }>

export const FundWithdrawalList = ({ fundId }: FundWithdrawalListProps): React.ReactElement | null => {
  const portfolio = usePortfolio()
  const pool = portfolio.data?.pools.find((candidate) => candidate.fundId === fundId)
  const hasWithdrawals = pool !== undefined && pool.withdrawnTotalPaise !== "0"
  const ledger = useWholeLedger(hasWithdrawals)
  const earlyExits = useSipEarlyExits()
  if (!hasWithdrawals) return null
  const earlyExitEntries = new Set((earlyExits.data?.items ?? []).map((exit) => exit.entryId))

  return (
    <Section
      title="Withdrawals"
      description="Money taken out of this investment to be returned to you, such as an early exit or a maturity payout."
    >
      <AsyncBoundary query={ledger} skeleton={listSkeleton}>
        {(data) => {
          if (ledger.hasMore) return listSkeleton
          const withdrawals = data.items
            .filter((entry) => entry.fundId === fundId && entry.type === "withdrawal")
            .sort(newestFirst)
          if (withdrawals.length === 0) {
            return (
              <EmptyState
                title="No withdrawal entries found"
                description="This investment shows an amount withdrawn. Contact support if it is not listed in your activity."
              />
            )
          }
          return (
            <div className={cx(CARD_STACK, FEED_MEASURE)}>
              {earlyExits.isError ? (
                <InlineReadFailure
                  label="Couldn’t check which withdrawals were early exits"
                  retrying={earlyExits.isFetching}
                  onRetry={() => {
                    void earlyExits.refetch()
                  }}
                />
              ) : null}
              {withdrawals.map((entry) => (
                <Card key={entry.id}>
                  <div className={ROW}>
                    <div className={ROW_LEFT}>
                      <Badge tone="neutral">{earlyExitEntries.has(entry.id) ? EARLY_EXIT_LABEL : WITHDRAWAL_LABEL}</Badge>
                      <span className={META_MUTED}>{formatDate(`${entry.date}T00:00:00Z`)}</span>
                    </div>
                    <div className={ROW_RIGHT}>
                      <MoneyValue amount={toPaise(entry.valueDeltaPaise)} size="md" tone="signed" showSign showDecimals />
                      <span className={META_MUTED}>change in value</span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )
        }}
      </AsyncBoundary>
    </Section>
  )
}
