import { useEffect, useMemo } from "react"
import { Link, useParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { formatDate, formatDateTime } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { paymentFailureReason } from "~/domain/paymentReason"
import { paymentPartnerName } from "~/domain/provider"
import { supportReference } from "~/domain/reference"
import { clientInvestmentStatus } from "~/domain/status"
import { PAYMENT_NOT_COMPLETED, useOnlinePaymentsOff } from "~/features/investing/onlinePayments"
import {
  OPEN_PAYMENT_STATUSES,
  hasCheckoutLapsed,
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

import { closeCheckout } from "./openCheckout"
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

const LAPSED_COPY =
  "The time to complete this payment has passed without a confirmed payment, so nothing was charged unless your bank shows otherwise. If money has left your account, contact the BeOnEdge team through Support with the reference below."

const FAILED_WHILE_PAYMENTS_OFF_COPY =
  "This payment did not go through and nothing was taken from your account."

const NOT_COMPLETED_WHILE_PAYMENTS_OFF_COPY =
  "This payment was not completed in the app. If money has left your account for it, contact the BeOnEdge team through Support with the reference below."

type AnswerInput = Readonly<{ status: string; lapsed: boolean; paymentsOff: boolean }>

const answerFor = ({ status, lapsed, paymentsOff }: AnswerInput): string => {
  if (paymentsOff && status === "payment_in_progress") return NOT_COMPLETED_WHILE_PAYMENTS_OFF_COPY
  if (lapsed) return LAPSED_COPY
  if (paymentsOff && status === "payment_failed") return FAILED_WHILE_PAYMENTS_OFF_COPY
  return COPY[status] ?? ""
}

const PaymentStatusScreen = (): React.ReactElement => {
  const { paymentId = "" } = useParams()
  const store = useMemo(browserPendingPaymentStore, [])
  const invalidateMoney = useInvalidateMoney()
  const paymentsOff = useOnlinePaymentsOff()

  const query = usePayment(paymentId)
  const funds = useFundCatalogue()
  const status = query.data?.payment.status ?? null

  useEffect(() => {
    if (status === null || OPEN_PAYMENT_STATUSES.includes(status)) return
    clearPendingPayment(store)
    void invalidateMoney()

    // The payer may still be looking at the provider's return page in the checkout tab.
    // The result is in, this screen is already showing it underneath, so dismiss the tab
    // and reveal it. This is what makes the return work without an App Link: verification
    // can fail, the domain can be unverified on an older install, or the provider can
    // finish inside its own web view, and the app still comes forward.
    void closeCheckout()
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
          const lapsed =
            hasCheckoutLapsed(payment, query.dataUpdatedAt) ||
            (paymentsOff && payment.status === "payment_in_progress")
          const failed = payment.status === "payment_failed"
          const answer = answerFor({ status: payment.status, lapsed, paymentsOff })
          const isOpen = OPEN_PAYMENT_STATUSES.includes(payment.status) && !lapsed
          const formatSettledAt = payment.provider === null ? formatDate : formatDateTime

          return (
            <>
              <Card elevated>
                <div className={PAYMENT_HERO}>
                  <div className={PAYMENT_STATUS_ROW}>
                    <StatusBadge status={lapsed ? PAYMENT_NOT_COMPLETED : clientInvestmentStatus(payment.status)} />
                    {isOpen ? (
                      <span className={STATE_REFRESHING}>
                        <Spinner size="sm" label="Checking for an update" />
                        Checking for an update
                      </span>
                    ) : null}
                  </div>
                  <p className={PAYMENT_ANSWER}>{answer}</p>
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
                      {formatSettledAt(payment.succeededAt)}
                    </DetailRow>
                  )}
                  {payment.confirmedAt === null ? null : (
                    <DetailRow label="Invested">{formatSettledAt(payment.confirmedAt)}</DetailRow>
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
                  {payment.status === "support_required" || lapsed ? (
                    <ButtonLink to="/profile/support">Contact support</ButtonLink>
                  ) : null}
                  {payment.status === "confirmed" ? (
                    <ButtonLink to="/portfolio" trailing>
                      See my portfolio
                    </ButtonLink>
                  ) : null}
                  {failed && !paymentsOff ? (
                    <ButtonLink to={`/funds/${payment.fundId}`} trailing>
                      Try again
                    </ButtonLink>
                  ) : null}
                  <ButtonLink to="/activity" tone="secondary">
                    Back to activity
                  </ButtonLink>
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
