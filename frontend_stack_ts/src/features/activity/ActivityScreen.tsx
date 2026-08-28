import { Link, useSearchParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDate, formatDateTime } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { clientInvestmentStatus } from "~/domain/status"
import { useFunds, usePayments, useTransactions } from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Badge } from "~/ui/primitives/Badge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { Tabs } from "~/ui/primitives/Toggle"

import styles from "./Activity.module.css"

const LABEL = {
  lump_sum: "Lump sum",
  sip_installment: "SIP installment",
  gain_allocation: "Growth",
  adjustment: "Adjustment",
} as const

const TONE = {
  lump_sum: "info",
  sip_installment: "info",
  gain_allocation: "positive",
  adjustment: "neutral",
} as const

const TABS = [
  { value: "ledger", label: "Value ledger" },
  { value: "payments", label: "Payments" },
] as const

type Tab = (typeof TABS)[number]["value"]

const PAYMENT_FILTERS = [
  { value: "all", label: "All" },
  { value: "payment_in_progress", label: "In progress" },
  { value: "processing", label: "Processing" },
  { value: "confirmed", label: "Confirmed" },
  { value: "payment_failed", label: "Failed" },
  { value: "support_required", label: "Needs support" },
  { value: "refunded", label: "Refunded" },
] as const

type PaymentFilter = (typeof PAYMENT_FILTERS)[number]["value"]

const asTab = (value: string | null): Tab => (value === "payments" ? "payments" : "ledger")

const asFilter = (value: string | null): PaymentFilter =>
  PAYMENT_FILTERS.some((filter) => filter.value === value) ? (value as PaymentFilter) : "all"

const ActivityScreen = (): React.ReactElement => {
  const [params, setParams] = useSearchParams()
  const tab = asTab(params.get("tab"))
  const filter = asFilter(params.get("status"))

  const ledger = useTransactions()
  const payments = usePayments(filter)
  const funds = useFunds()

  const nameFor = (fundId: string | null): string =>
    fundId === null
      ? "Fund"
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
        description="Every movement in your value ledger, and every payment behind it."
      />

      <Tabs label="Activity view" value={tab} items={TABS} onChange={setTab} />

      {tab === "ledger" ? (
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
              title="Nothing has happened yet"
              description="Contributions, growth adjustments and corrections appear here once they settle."
              action={
                <Link to="/funds">
                  <Button trailing>Browse funds</Button>
                </Link>
              }
            />
          }
        >
          {(data) => (
            <div className={styles.list}>
              {[...data.items]
                .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
                .map((entry) => (
                  <Card key={entry.id}>
                    <div className={styles.row}>
                      <div className={styles.left}>
                        <Badge tone={TONE[entry.type]}>{LABEL[entry.type]}</Badge>
                        <Link to={`/funds/${entry.fundId}`} className={styles.fundLink}>
                          {nameFor(entry.fundId)}
                        </Link>
                        <span className={styles.date}>{formatDate(`${entry.date}T00:00:00Z`)}</span>
                      </div>
                      <div className={styles.right}>
                        <MoneyValue
                          amount={toPaise(entry.valueDeltaPaise)}
                          size="md"
                          tone="signed"
                          showSign
                        />
                        <span className={styles.sub}>value change</span>
                      </div>
                    </div>
                  </Card>
                ))}
            </div>
          )}
        </AsyncBoundary>
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
                    ? "Payments appear once you invest. Coming back from a checkout does not settle a payment; the provider does."
                    : "No payment on this account is in that state right now."
                }
              />
            }
          >
            {(data) => (
              <div className={styles.list}>
                {data.items.map((payment) => (
                  <Link
                    key={payment.id}
                    to={`/activity/payments/${payment.id}`}
                    className={styles.fundLink}
                  >
                    <Card>
                      <div className={styles.row}>
                        <div className={styles.left}>
                          <StatusBadge status={clientInvestmentStatus(payment.status)} />
                          <span className={styles.fundLink}>{nameFor(payment.fundId)}</span>
                          <span className={styles.date}>{formatDateTime(payment.createdAt)}</span>
                        </div>
                        <div className={styles.right}>
                          <MoneyValue amount={toPaise(payment.amountPaise)} size="md" />
                          <span className={styles.sub}>
                            {payment.provider ?? "no provider attempt yet"}
                          </span>
                        </div>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </AsyncBoundary>
        </>
      )}
    </Page>
  )
}

export default ActivityScreen
