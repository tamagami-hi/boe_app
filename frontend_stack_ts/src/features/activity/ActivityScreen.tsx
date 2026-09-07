import { Link, useSearchParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDate, formatDateTime } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { clientInvestmentStatus } from "~/domain/status"
import { useFundCatalogue, usePayments, useTransactions } from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { CARD_LINK, CARD_STACK } from "~/ui/recipes/surface"
import { FEED_MEASURE } from "~/ui/recipes/layout"
import { cx } from "~/lib/cx"
import { META_MUTED } from "~/ui/recipes/text"
import { Badge } from "~/ui/primitives/Badge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { paymentPartnerName } from "~/domain/provider"
import { Skeleton } from "~/ui/primitives/Feedback"
import { Tabs } from "~/ui/primitives/Toggle"

import { FUND_LINK, ROW, ROW_LEFT, ROW_RIGHT } from "./activity.recipe"

const LABEL = {
  lump_sum: "One-off investment",
  sip_installment: "SIP instalment",
  gain_allocation: "Growth",
  adjustment: "Correction",
} as const

const TONE = {
  lump_sum: "info",
  sip_installment: "info",
  gain_allocation: "positive",
  adjustment: "neutral",
} as const

const TABS = [
  { value: "ledger", label: "Investments" },
  { value: "payments", label: "Payments" },
] as const

type Tab = (typeof TABS)[number]["value"]

const PAYMENT_FILTERS = [
  { value: "all", label: "All" },
  { value: "payment_in_progress", label: "Awaiting payment" },
  { value: "processing", label: "Being invested" },
  { value: "confirmed", label: "Invested" },
  { value: "payment_failed", label: "Failed" },
  { value: "support_required", label: "Needs review" },
  { value: "refunded", label: "Refunded" },
] as const

type PaymentFilter = (typeof PAYMENT_FILTERS)[number]["value"]

const partnerLabel = (provider: string | null): string | null => paymentPartnerName(provider)

const asTab = (value: string | null): Tab => (value === "payments" ? "payments" : "ledger")

const asFilter = (value: string | null): PaymentFilter =>
  PAYMENT_FILTERS.some((filter) => filter.value === value) ? (value as PaymentFilter) : "all"

const ActivityScreen = (): React.ReactElement => {
  const [params, setParams] = useSearchParams()
  const tab = asTab(params.get("tab"))
  const filter = asFilter(params.get("status"))

  const ledger = useTransactions()
  const payments = usePayments(filter)
  const funds = useFundCatalogue()

  const nameFor = (fundId: string | null): string =>
    fundId === null
      ? "Your portfolio"
      : (funds.data?.items.find((fund) => fund.id === fundId)?.name ?? "Fund")

  const setTab = (next: Tab): void => {
    setParams(next === "ledger" ? {} : { tab: next }, { replace: true })
  }

  const setFilter = (next: PaymentFilter): void => {
    setParams(next === "all" ? { tab: "payments" } : { tab: "payments", status: next }, {
      replace: true,
    })
  }

  return (
    <Page width="default">
      <PageHeader
        title="Activity"
        description="Everything that has happened to your investments, and every payment behind it."
      />

      <Tabs label="Activity view" value={tab} items={TABS} onChange={setTab} />

      {tab === "ledger" ? (
        <>
        <AsyncBoundary
          query={ledger}
          skeleton={
            <Card>
              <Skeleton height="1rem" width="45%" />
              <Skeleton height="1rem" width="70%" />
            </Card>
          }
          isEmpty={(data) => data.items.length === 0}
          empty={
            <EmptyState
              title="Nothing here yet"
              description="Your investments and their growth will appear here once your first payment is complete."
              action={
                <Link to="/funds">
                  <Button trailing>Browse funds</Button>
                </Link>
              }
            />
          }
        >
          {(data) => (
            <div className={cx(CARD_STACK, FEED_MEASURE)}>
              {[...data.items]
                .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
                .map((entry) => (
                  <Card key={entry.id}>
                    <div className={ROW}>
                      <div className={ROW_LEFT}>
                        <Badge tone={TONE[entry.type]}>{LABEL[entry.type]}</Badge>
                        <Link to={`/funds/${entry.fundId}`} className={FUND_LINK}>
                          {nameFor(entry.fundId)}
                        </Link>
                        <span className={META_MUTED}>
                          {formatDate(`${entry.date}T00:00:00Z`)}
                        </span>
                      </div>
                      <div className={ROW_RIGHT}>
                        <MoneyValue
                          amount={toPaise(entry.valueDeltaPaise)}
                          size="md"
                          tone="signed"
                          showSign
                        />
                        <span className={META_MUTED}>change in value</span>
                      </div>
                    </div>
                  </Card>
                ))}
            </div>
          )}
        </AsyncBoundary>
        <LoadMore list={ledger} noun="entries" />
        </>
      ) : (
        <>
          <Tabs
            label="Payment status"
            value={filter}
            items={PAYMENT_FILTERS}
            onChange={setFilter}
          />
          <AsyncBoundary
            query={payments}
            skeleton={
              <Card>
                <Skeleton height="1rem" width="45%" />
                <Skeleton height="1rem" width="70%" />
              </Card>
            }
            isEmpty={(data) => data.items.length === 0}
            empty={
              <EmptyState
                title="No payments here"
                description={
                  filter === "all"
                    ? "Your payments will appear here once you make your first investment."
                    : "You have no payments with this status right now."
                }
              />
            }
          >
            {(data) => (
              <div className={cx(CARD_STACK, FEED_MEASURE)}>
                {data.items.map((payment) => (
                  <Link
                    key={payment.id}
                    to={`/activity/payments/${payment.id}`}
                    className={CARD_LINK}
                  >
                    <Card>
                      <div className={ROW}>
                        <div className={ROW_LEFT}>
                          <StatusBadge status={clientInvestmentStatus(payment.status)} />
                          <span className={FUND_LINK}>{nameFor(payment.fundId)}</span>
                          <span className={META_MUTED}>{formatDateTime(payment.createdAt)}</span>
                        </div>
                        <div className={ROW_RIGHT}>
                          <MoneyValue amount={toPaise(payment.amountPaise)} size="md" />
                          {partnerLabel(payment.provider) === null ? null : (
                            <span className={META_MUTED}>{partnerLabel(payment.provider)}</span>
                          )}
                        </div>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </AsyncBoundary>
          <LoadMore list={payments} noun="payments" />
        </>
      )}
    </Page>
  )
}

export default ActivityScreen
