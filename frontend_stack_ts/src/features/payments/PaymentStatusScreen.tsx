import { useEffect, useMemo } from "react"
import { Link, useParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { formatDateTime } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { paymentFailureReason } from "~/domain/paymentReason"
import { paymentPartnerName } from "~/domain/provider"
import { supportReference } from "~/domain/reference"
import { clientInvestmentStatus } from "~/domain/status"
import {
  OPEN_PAYMENT_STATUSES,
  useFundCatalogue,
  useInvalidateMoney,
  usePayment,
} from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"

import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Skeleton, Spinner } from "~/ui/primitives/Feedback"
import { STAT_LABEL, STAT_ROOT, SUMMARY_GRID } from "~/ui/recipes/datalist"
import { ACTION_ROW } from "~/ui/recipes/layout"
import { STATE_REFRESHING } from "~/ui/recipes/state"
import { LINK_TEXT } from "~/ui/recipes/text"

import { browserPendingPaymentStore, clearPendingPayment } from "./pendingPayment"
import { PAYMENT_ANSWER, PAYMENT_HERO, PAYMENT_STATUS_ROW } from "./payments.recipe"

const COPY: Readonly<Record<string, string>> = {
  payment_in_progress:
    "We're waiting for confirmation of this payment. This page updates on its own.",
  processing:
    "Your payment has arrived and is being invested in the fund. Your units appear once that is done.",
  confirmed:
    "This payment is complete and invested. It appears in your portfolio and in this month's statement.",
  refund_in_progress:
    "A refund is on its way back to the account you paid from. How long it takes depends on your bank.",
  refunded: "This payment has been refunded in full.",
  support_required:
    "This payment needs a closer look from our team. Contact support with the reference below and we will sort it out.",
  payment_failed:
    "This payment did not go through and nothing was taken from your account. You can try investing again.",
}

const PaymentStatusScreen = (): React.ReactElement => {
  const { paymentId = "" } = useParams()
  const store = useMemo(browserPendingPaymentStore, [])
  const invalidateMoney = useInvalidateMoney()

  const query = usePayment(paymentId)
  const funds = useFundCatalogue()
  const status = query.data?.payment.status ?? null

  useEffect(() => {
    if (status === null || OPEN_PAYMENT_STATUSES.includes(status)) return
    clearPendingPayment(store)
    void invalidateMoney()
  }, [status, store, invalidateMoney])

  return (
    <Page width="form">
      <PageHeader title="Payment" description="Where this payment has got to." />

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
          const fundName = funds.data?.items.find((fund) => fund.id === payment.fundId)?.name ?? null
          const partner = paymentPartnerName(payment.provider)
          const reason = paymentFailureReason(payment.failureCode)
          const reference = supportReference(payment.paymentId)
          const isOpen = OPEN_PAYMENT_STATUSES.includes(payment.status)

          return (
            <>
              <Card elevated>
                <div className={PAYMENT_HERO}>
                  <div className={PAYMENT_STATUS_ROW}>
                    <StatusBadge status={clientInvestmentStatus(payment.status)} />
                    {isOpen ? (
                      <span className={STATE_REFRESHING}>
                        <Spinner size="sm" label="Checking for an update" />
                        Checking for an update
                      </span>
                    ) : null}
                  </div>
                  <p className={PAYMENT_ANSWER}>{COPY[payment.status] ?? ""}</p>
                </div>

                <div className={SUMMARY_GRID}>
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Amount</span>
                    <MoneyValue amount={toPaise(payment.amountPaise)} size="lg" />
                  </div>
                  {fundName === null ? null : (
                    <div className={STAT_ROOT}>
                      <span className={STAT_LABEL}>Fund</span>
                      <Link to={`/funds/${payment.fundId}`} className={LINK_TEXT}>
                        {fundName}
                      </Link>
                    </div>
                  )}
                </div>
              </Card>

              <Card>
                <DataList>
                  <DetailRow label="Started">{formatDateTime(payment.createdAt)}</DetailRow>
                  {payment.succeededAt === null ? null : (
                    <DetailRow label="Payment received">
                      {formatDateTime(payment.succeededAt)}
                    </DetailRow>
                  )}
                  {payment.confirmedAt === null ? null : (
                    <DetailRow label="Invested">{formatDateTime(payment.confirmedAt)}</DetailRow>
                  )}
                  {payment.refundedAt === null ? null : (
                    <DetailRow label="Refunded">{formatDateTime(payment.refundedAt)}</DetailRow>
                  )}
                  {isOpen && payment.expiresAt !== null ? (
                    <DetailRow label="Pay by">{formatDateTime(payment.expiresAt)}</DetailRow>
                  ) : null}
                  {partner === null ? null : <DetailRow label="Paid with">{partner}</DetailRow>}
                  {reason === null ? null : (
                    <DetailRow label="Reason" emphasis="lead">
                      {reason}
                    </DetailRow>
                  )}
                  {reference === null ? null : (
                    <DetailRow label="Reference ID">{reference}</DetailRow>
                  )}
                </DataList>
              </Card>

              <Section>
                <div className={ACTION_ROW}>
                  <ButtonLink to="/activity" tone="secondary">
Back to activity
</ButtonLink>
                  {payment.status === "support_required" ? (
                    <ButtonLink to="/profile/support">
Contact support
</ButtonLink>
                  ) : null}
                  {payment.status === "confirmed" ? (
                    <ButtonLink to="/portfolio" trailing>
See my portfolio
</ButtonLink>
                  ) : null}
                  {payment.status === "payment_failed" ? (
                    <ButtonLink to={`/funds/${payment.fundId}`} trailing>
                      Try again
                    </ButtonLink>
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
