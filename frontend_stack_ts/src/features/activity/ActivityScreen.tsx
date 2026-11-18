import { Link, useSearchParams } from "react-router-dom"
import type { ReactNode } from "react"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { clientInvestmentStatus } from "~/domain/status"
import { INVESTMENTS_RECORDED_HERE } from "~/features/investing/InvestmentsRecorded"
import { useOnlinePaymentsOff } from "~/features/investing/onlinePayments"
import { FundName, FundNamesFailure, useFundNames } from "~/features/invested-funds/FundNames"
import { investedFundPath } from "~/features/invested-funds/investedFundPath"
import { EARLY_EXIT_LABEL, useSipEarlyExits } from "~/features/portfolio/sipEarlyExitQueries"
import { InlineReadFailure } from "~/features/shared/InlineReadFailure"
import {
  useFundCatalogue,
  usePayments,
  usePortfolio,
  useTransactions,
} from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { MoneyFootnote } from "~/ui/patterns/MoneyFootnote"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { CARD_STACK } from "~/ui/recipes/surface"
import { ACTION_ROW, FEED_MEASURE } from "~/ui/recipes/layout"
import { cx } from "~/lib/cx"
import { LINK_TEXT, META_MUTED } from "~/ui/recipes/text"
import { Badge } from "~/ui/primitives/Badge"

import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { TabPanel, Tabs } from "~/ui/primitives/Toggle"

import { HISTORY_PANEL, ROW, ROW_LEFT, ROW_RIGHT } from "./activity.recipe"
import { OnlinePaymentHistory } from "./OnlinePaymentHistory"
import { PaymentCard } from "./PaymentCard"

const LABEL = {
  lump_sum: "One-off investment",
  sip_installment: "SIP instalment",
  recorded_offline: "Investment recorded",
  gain_allocation: "Growth",
  adjustment: "Correction",
  withdrawal: "Withdrawal",
  maturity_reinvestment: "Maturity reinvestment",
} as const

const TONE = {
  lump_sum: "info",
  sip_installment: "info",
  recorded_offline: "info",
  gain_allocation: "positive",
  adjustment: "neutral",
  withdrawal: "neutral",
  maturity_reinvestment: "info",
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

type DatedEntry = Readonly<{ date: string; createdAt: string }>

const newestFirst = (left: DatedEntry, right: DatedEntry): number =>
  right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt)

const asTab = (value: string | null): Tab => (value === "payments" ? "payments" : "ledger")

const asFilter = (value: string | null): PaymentFilter =>
  PAYMENT_FILTERS.some((filter) => filter.value === value) ? (value as PaymentFilter) : "all"

const ACTIVITY_TABS_ID = "activity-view"

const PAYMENT_FILTER_TABS_ID = "activity-payment-status"

type LedgerPanelProps = Readonly<{ tabbed: boolean; children: ReactNode }>

const LedgerPanel = ({ tabbed, children }: LedgerPanelProps): React.ReactElement =>
  tabbed ? (
    <TabPanel id={ACTIVITY_TABS_ID} value="ledger">
      {children}
    </TabPanel>
  ) : (
    <section className={HISTORY_PANEL} aria-label="History">
      {children}
    </section>
  )

const ActivityScreen = (): React.ReactElement => {
  const [params, setParams] = useSearchParams()
  const paymentsOff = useOnlinePaymentsOff()
  const tab = paymentsOff ? "ledger" : asTab(params.get("tab"))
  const filter = paymentsOff ? "all" : asFilter(params.get("status"))

  const ledger = useTransactions()
  const payments = usePayments(filter)
  const funds = useFundCatalogue()
  const names = useFundNames()
  const portfolio = usePortfolio()
  const earlyExits = useSipEarlyExits()
  const earlyExitEntries = new Set((earlyExits.data?.items ?? []).map((exit) => exit.entryId))

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
        description={
          paymentsOff
            ? "Your investments, value updates and withdrawals, newest first."
            : "Everything that has happened to your investments, and every payment behind it."
        }
      />

      <div className={ACTION_ROW}>
        <ButtonLink to="/activity/receipts" tone="secondary" size="sm">
          Receipts
        </ButtonLink>
      </div>

      {paymentsOff ? null : (
        <Tabs id={ACTIVITY_TABS_ID} label="Activity view" value={tab} items={TABS} onChange={setTab} />
      )}

      {tab === "ledger" ? (
        <LedgerPanel tabbed={!paymentsOff}>
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
              description={
                paymentsOff
                  ? INVESTMENTS_RECORDED_HERE
                  : "Your investments and their growth will appear here once your first payment is complete."
              }
              action={
                paymentsOff ? null : (
                  <ButtonLink to="/funds" trailing>
                    Browse funds
                  </ButtonLink>
                )
              }
            />
          }
        >
          {(data) => (
            <div className={cx(CARD_STACK, FEED_MEASURE)}>
              <FundNamesFailure names={names} />
              {earlyExits.isError && data.items.some((entry) => entry.type === "withdrawal") ? (
                <InlineReadFailure
                  label="Couldn’t check which withdrawals were early exits"
                  retrying={earlyExits.isFetching}
                  onRetry={() => {
                    void earlyExits.refetch()
                  }}
                />
              ) : null}
              {[...data.items]
                .sort(newestFirst)
                .map((entry) => (
                  <Card key={entry.id}>
                    <div className={ROW}>
                      <div className={ROW_LEFT}>
                        <Badge tone={TONE[entry.type]}>
                          {entry.type === "withdrawal" && earlyExitEntries.has(entry.id) ? EARLY_EXIT_LABEL : LABEL[entry.type]}
                        </Badge>
                        <Link to={investedFundPath(entry.fundId)} className={LINK_TEXT}>
                          <FundName names={names} fundId={entry.fundId} />
                        </Link>
                        <span className={META_MUTED}>
                          {formatDate(`${entry.date}T00:00:00Z`)}
                        </span>
                        {entry.type === "recorded_offline" ? (
                          <Link to={`/activity/receipts/${entry.id}`} className={LINK_TEXT}>
                            View receipt
                          </Link>
                        ) : null}
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
        {paymentsOff ? <OnlinePaymentHistory fundName={nameFor} /> : null}
        </LedgerPanel>
      ) : (
        <TabPanel id={ACTIVITY_TABS_ID} value="payments">
          <Tabs
            id={PAYMENT_FILTER_TABS_ID}
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
                  <PaymentCard
                    key={payment.id}
                    payment={payment}
                    fundName={nameFor(payment.fundId)}
                    status={clientInvestmentStatus(payment.status)}
                  />
                ))}
              </div>
            )}
          </AsyncBoundary>
          <LoadMore list={payments} noun="payments" />
        </TabPanel>
      )}

      <MoneyFootnote lastUpdated={portfolio.data?.lastUpdated ?? null} />
    </Page>
  )
}

export default ActivityScreen
