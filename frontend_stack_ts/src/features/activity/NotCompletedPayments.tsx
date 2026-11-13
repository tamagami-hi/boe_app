import type { listClientPayments } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import type { PagedQuery } from "~/api/paged"
import { Section } from "~/app/layouts/Section"
import { PAYMENT_NOT_COMPLETED } from "~/features/investing/onlinePayments"
import { cx } from "~/lib/cx"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { FEED_MEASURE } from "~/ui/recipes/layout"
import { CARD_STACK } from "~/ui/recipes/surface"

import { PaymentCard } from "./PaymentCard"

export type NotCompletedPaymentsProps = Readonly<{
  payments: PagedQuery<DataOf<typeof listClientPayments>>
  fundName: (fundId: string | null) => string
}>

export const NotCompletedPayments = ({
  payments,
  fundName,
}: NotCompletedPaymentsProps): React.ReactElement | null => {
  const stillLoading = payments.data === undefined && payments.error == null
  if (stillLoading || payments.data?.items.length === 0) return null

  return (
    <Section
      title="Online payments not completed"
      description="Started in the app but never completed. If money left your account for one, open it for the next step."
    >
      <AsyncBoundary query={payments} skeleton={null}>
        {(data) => (
          <div className={cx(CARD_STACK, FEED_MEASURE)}>
            {data.items.map((payment) => (
              <PaymentCard
                key={payment.id}
                payment={payment}
                fundName={fundName(payment.fundId)}
                status={PAYMENT_NOT_COMPLETED}
              />
            ))}
          </div>
        )}
      </AsyncBoundary>
      <LoadMore list={payments} noun="payments" />
    </Section>
  )
}
