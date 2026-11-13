import { useEffect } from "react"

import { listClientPayments } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { usePagedQuery } from "~/api/paged"
import type { PagedQuery } from "~/api/paged"
import { STALE, qk } from "~/api/queryKeys"
import { Section } from "~/app/layouts/Section"
import { useApi } from "~/app/providers/ApiProvider"
import { clientInvestmentStatus } from "~/domain/status"
import type { StatusPresentation } from "~/domain/status"
import { PAYMENT_NOT_COMPLETED } from "~/features/investing/onlinePayments"
import { cx } from "~/lib/cx"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { FEED_MEASURE } from "~/ui/recipes/layout"
import { CARD_STACK } from "~/ui/recipes/surface"

import { PaymentCard } from "./PaymentCard"
import type { ListedPayment } from "./PaymentCard"

const ALL_PAYMENTS = "all"

const PAGE_LIMIT = 25

const useEveryPayment = (): PagedQuery<DataOf<typeof listClientPayments>> => {
  const api = useApi()
  const payments = usePagedQuery({
    queryKey: qk.client.payments(ALL_PAYMENTS),
    staleTime: STALE.MONEY,
    fetchPage: async (after) =>
      api.request(listClientPayments, { query: { limit: PAGE_LIMIT, after } }),
  })
  const { hasMore, isLoadingMore, error, loadMore } = payments
  const pageFailed = error != null

  useEffect(() => {
    if (!hasMore || isLoadingMore || pageFailed) return
    loadMore()
  }, [hasMore, isLoadingMore, pageFailed])

  return payments
}

const notInvested = (payment: ListedPayment): boolean => payment.status !== "confirmed"

const statusOf = (payment: ListedPayment): StatusPresentation =>
  payment.status === "payment_in_progress"
    ? PAYMENT_NOT_COMPLETED
    : clientInvestmentStatus(payment.status)

export type OnlinePaymentHistoryProps = Readonly<{
  fundName: (fundId: string | null) => string
}>

export const OnlinePaymentHistory = ({
  fundName,
}: OnlinePaymentHistoryProps): React.ReactElement | null => {
  const payments = useEveryPayment()
  const everyPage = payments.hasMore ? undefined : payments.data
  const readFailed = payments.error != null && everyPage === undefined
  if (!readFailed && everyPage === undefined) return null

  const outstanding = everyPage?.items.filter(notInvested) ?? []
  if (!readFailed && outstanding.length === 0) return null

  return (
    <Section
      title="Online payments"
      description="Payments started in the app that did not become an investment. If money left your account for one of these, contact Support with its reference."
    >
      <AsyncBoundary
        query={{
          data: readFailed ? undefined : outstanding,
          isPending: false,
          isFetching: payments.isFetching,
          error: payments.error,
          refetch: payments.refetch,
        }}
        skeleton={null}
      >
        {(items) => (
          <div className={cx(CARD_STACK, FEED_MEASURE)}>
            {items.map((payment) => (
              <PaymentCard
                key={payment.id}
                payment={payment}
                fundName={fundName(payment.fundId)}
                status={statusOf(payment)}
              />
            ))}
          </div>
        )}
      </AsyncBoundary>
    </Section>
  )
}
