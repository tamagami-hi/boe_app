import { useEffect, useMemo } from "react"
import { Link, useParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { formatDateTime } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { clientInvestmentStatus } from "~/domain/status"
import { OPEN_PAYMENT_STATUSES, useInvalidateMoney, usePayment } from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Skeleton, Spinner } from "~/ui/primitives/Feedback"

import { browserPendingPaymentStore, clearPendingPayment } from "./pendingPayment"

import styles from "./Payments.module.css"

const COPY: Readonly<Record<string, string>> = {
  payment_in_progress:
    "We have not been told the money moved. Returning from PhonePe, or seeing a success screen there, is not settlement evidence — only the provider's own confirmation is. This screen updates itself.",
  processing:
    "PhonePe has taken the money and we are allocating it to the fund. Your units and value appear once the allocation is written to the ledger.",
  confirmed:
    "This payment is settled and allocated. It is part of your portfolio and appears in your statement for the month.",
  refund_in_progress:
    "A refund has been started for this payment. It returns to the account you paid from; the provider decides how long that takes.",
  refunded: "This payment has been refunded in full.",
  support_required:
    "This payment needs a human to look at it. Nothing more will happen automatically. Raise it with support and quote the reference below.",
  payment_failed:
    "This payment did not go through and nothing was taken. You can start a new one from the fund.",
}

const PaymentStatusScreen = (): React.ReactElement => {
  const { paymentId = "" } = useParams()
  const store = useMemo(browserPendingPaymentStore, [])
  const invalidateMoney = useInvalidateMoney()

  const query = usePayment(paymentId)
  const status = query.data?.payment.status ?? null

  useEffect(() => {
    if (status === null || OPEN_PAYMENT_STATUSES.includes(status)) return
    clearPendingPayment(store)
    void invalidateMoney()
  }, [status, store, invalidateMoney])

  return (
    <Page width="form">
      <PageHeader
        title="Payment"
        description="The authoritative state of this payment, as the backend reports it."
      />

      <AsyncBoundary
        query={query}
        skeleton={
          <Card>
            <Skeleton height="0.9rem" width="30%" />
            <Skeleton height="2.6rem" width="55%" />
          </Card>
        }
      >
        {(data) => {
          const payment = data.payment
          return (
            <>
              <Card elevated>
                <div className={styles.hero}>
                  <span className={styles.label}>Amount</span>
                  <MoneyValue amount={toPaise(payment.amountPaise)} size="xl" />
                  <div className={styles.statusRow}>
                    <StatusBadge status={clientInvestmentStatus(payment.status)} />
                    {OPEN_PAYMENT_STATUSES.includes(payment.status) ? (
                      <span className={styles.polling}>
                        <Spinner size="sm" label="Checking" />
                        Checking with the provider
                      </span>
                    ) : null}
                  </div>
                </div>

                <p className={styles.honesty}>{COPY[payment.status] ?? ""}</p>
              </Card>

              <Card>
                <DataList>
                  <DetailRow label="Payment reference">{payment.paymentId}</DetailRow>
                  <DetailRow label="Order">{payment.orderId}</DetailRow>
                  <DetailRow label="Provider">{payment.provider ?? "—"}</DetailRow>
                  <DetailRow label="Started">{formatDateTime(payment.createdAt)}</DetailRow>
                  {payment.expiresAt === null ? null : (
                    <DetailRow label="Checkout expires">
                      {formatDateTime(payment.expiresAt)}
                    </DetailRow>
                  )}
                  {payment.succeededAt === null ? null : (
                    <DetailRow label="Taken by provider">
                      {formatDateTime(payment.succeededAt)}
                    </DetailRow>
                  )}
                  {payment.confirmedAt === null ? null : (
                    <DetailRow label="Allocated">{formatDateTime(payment.confirmedAt)}</DetailRow>
                  )}
                  {payment.refundedAt === null ? null : (
                    <DetailRow label="Refunded">{formatDateTime(payment.refundedAt)}</DetailRow>
                  )}
                  {payment.failureCode === null ? null : (
                    <DetailRow label="Reported reason">{payment.failureCode}</DetailRow>
                  )}
                </DataList>
              </Card>

              <Section>
                <div className={styles.actions}>
                  <Link to="/activity">
                    <Button tone="secondary">Back to activity</Button>
                  </Link>
                  {payment.status === "support_required" ? (
                    <Link to="/profile/support">
                      <Button>Raise it with support</Button>
                    </Link>
                  ) : null}
                  {payment.status === "confirmed" ? (
                    <Link to="/portfolio">
                      <Button trailing>See my portfolio</Button>
                    </Link>
                  ) : null}
                  {payment.status === "payment_failed" ? (
                    <Link to={`/funds/${payment.fundId}`}>
                      <Button trailing>Try again</Button>
                    </Link>
                  ) : null}
                </div>
              </Section>
            </>
          )
        }}
      </AsyncBoundary>
    </Page>
  )
}

export default PaymentStatusScreen
