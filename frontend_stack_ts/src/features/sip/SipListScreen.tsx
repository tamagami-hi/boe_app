import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { sipState } from "~/domain/status"
import { useFunds, useSipPlans } from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { CARD_LINK } from "~/ui/recipes/surface"

import { SIP_CARD_TOP, SIP_LIST, SIP_SCHEDULE } from "./sip.recipe"
import { ITEM_TITLE } from "~/ui/recipes/datalist"

const SipListScreen = (): React.ReactElement => {
  const query = useSipPlans()
  const funds = useFunds()

  const nameFor = (fundId: string): string =>
    funds.data?.items.find((fund) => fund.id === fundId)?.name ?? "Fund"

  return (
    <Page width="default">
      <PageHeader
        title="SIP plans"
        description="Every standing plan on your account, whether it is paid manually or by mandate."
      />

      <AsyncBoundary
        query={query}
        skeleton={
          <div className={SIP_LIST}>
            {[0, 1].map((index) => (
              <Card key={index}>
                <Skeleton height="1.1rem" width="55%" />
                <Skeleton height="0.85rem" width="40%" />
              </Card>
            ))}
          </div>
        }
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            title="You have no SIP plans"
            description="A SIP invests the same amount every month. You can start one from any fund."
            action={
              <Link to="/funds">
                <Button trailing>Browse funds</Button>
              </Link>
            }
          />
        }
      >
        {(data) => (
          <div className={SIP_LIST}>
            {data.items.map((plan) => (
              <Link key={plan.sipId} to={`/sips/${plan.sipId}`} className={CARD_LINK}>
                <Card>
                  <div className={SIP_CARD_TOP}>
                    <span className={ITEM_TITLE}>{nameFor(plan.fundId)}</span>
                    <StatusBadge status={sipState(plan.status)} />
                  </div>
                  <MoneyValue amount={toPaise(plan.amountPaise)} size="md" />
                  <div className={SIP_SCHEDULE}>
                    <span>Day {String(plan.debitDay)} of the month</span>
                    <span>
                      {plan.durationMonths === null
                        ? "No end date"
                        : `${String(plan.durationMonths)} installments`}
                    </span>
                    {plan.nextDueDate === null ? null : (
                      <span>Next due {formatDate(plan.nextDueDate)}</span>
                    )}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default SipListScreen
