import { Section } from "~/app/layouts/Section"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Badge } from "~/ui/primitives/Badge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { STACK_LG } from "~/ui/recipes/layout"
import { CARD_TITLE } from "~/ui/recipes/text"

import { useClientSipEarlyExits, type AdminSipEarlyExitItem } from "./earlyExitQueries"
import { WithdrawalPayoutPanel } from "./WithdrawalPayoutPanel"

const dateOf = (isoDate: string): string => formatDate(`${isoDate}T00:00:00Z`)

type EarlyExitCardProps = Readonly<{
  item: AdminSipEarlyExitItem
  investorLabel: string
  canWrite: boolean
  onReload: () => void
}>

const EarlyExitCard = ({ item, investorLabel, canWrite, onReload }: EarlyExitCardProps): React.ReactElement => (
  <div className={STACK_LG}>
    <Card>
      <div className={STACK_LG}>
        <span className={CARD_TITLE}>{item.fundName}</span>
        <Badge tone="neutral">{`Closed early on ${dateOf(item.effectiveDate)}`}</Badge>
        <DataList split>
          <DetailRow label="Returned to the client">
            <MoneyValue amount={toPaise(item.amountPaise)} size="sm" showDecimals />
          </DetailRow>
          <DetailRow label="Of which invested">
            <MoneyValue amount={toPaise(item.payout.principalPortionPaise)} size="sm" showDecimals />
          </DetailRow>
          <DetailRow label="Of which growth">
            <MoneyValue amount={toPaise(item.payout.growthPortionPaise)} size="sm" showDecimals />
          </DetailRow>
          <DetailRow label="Maturity date cancelled">
            {item.cancelledMaturityDate === null ? "None was set" : dateOf(item.cancelledMaturityDate)}
          </DetailRow>
        </DataList>
      </div>
    </Card>
    <WithdrawalPayoutPanel
      payout={item.payout}
      investorLabel={investorLabel}
      fundName={`${item.fundName}, early exit`}
      canWrite={canWrite}
      onReload={onReload}
    />
  </div>
)

export type SipEarlyExitListProps = Readonly<{ userId: string; investorLabel: string; canWrite: boolean }>

export const SipEarlyExitList = ({ userId, investorLabel, canWrite }: SipEarlyExitListProps): React.ReactElement | null => {
  const exits = useClientSipEarlyExits(userId)
  if (userId === "" || exits.data?.items.length === 0) return null

  return (
    <Section
      title="Early exits"
      description="SIPs closed before their last month. Each one withdrew the full value of the holding as a payout. Recording it does not send money: record the bank transfer outcome here once the transfer is made."
    >
      <AsyncBoundary
        query={exits}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="40%" />
            <Skeleton height="2rem" />
          </Card>
        }
      >
        {(data) => (
          <div className={STACK_LG}>
            {data.items.map((item) => (
              <EarlyExitCard
                key={item.earlyExitId}
                item={item}
                investorLabel={investorLabel}
                canWrite={canWrite}
                onReload={() => {
                  void exits.refetch()
                }}
              />
            ))}
          </div>
        )}
      </AsyncBoundary>
    </Section>
  )
}
