import { useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { isApiError } from "~/api/errors"
import { useIdempotencyKey } from "~/api/idempotency"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { comparePaise, formatINR, rupeesToPaise, toPaise } from "~/domain/money"
import type { Paise } from "~/domain/money"
import { CheckoutUrlRejected, decideCheckout } from "~/features/payments/checkout"
import {
  PENDING_PAYMENT_TTL_MS,
  browserPendingPaymentStore,
  persistPendingPayment,
} from "~/features/payments/pendingPayment"
import { useCreateOrder, useFund, usePayOrder } from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { STAT_LABEL } from "~/ui/recipes/datalist"
import { FIELD_ERROR } from "~/ui/recipes/field"
import { META_MUTED, SECTION_TITLE } from "~/ui/recipes/text"
import { AmountInput } from "~/ui/primitives/AmountInput"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { PresetChoice } from "~/ui/primitives/Toggle"

import { RiskConsent } from "./RiskConsent"

import { AMOUNT_BLOCK, FORM, FUND_LINE, RULE, RULES, RULE_DOT } from "./orders.recipe"

const PRESETS = [1_000, 5_000, 10_000, 25_000, 50_000] as const

const rupeeFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
})

const LumpsumInvestScreen = (): React.ReactElement => {
  const { fundId = "" } = useParams()
  const fund = useFund(fundId)
  const navigate = useNavigate()
  const { principal } = useSession()
  const createOrder = useCreateOrder()
  const payOrder = usePayOrder()

  const [rupees, setRupees] = useState("")
  const [consented, setConsented] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const store = useMemo(browserPendingPaymentStore, [])

  const minimum: Paise | null = useMemo(() => {
    const raw = fund.data?.fund.minimumPurchasePaise ?? null
    return raw === null ? null : toPaise(raw)
  }, [fund.data])

  const amountPaise: Paise | null = useMemo(() => {
    if (rupees === "") return null
    try {
      return rupeesToPaise(Number(rupees))
    } catch {
      return null
    }
  }, [rupees])

  const amountError =
    amountPaise === null
      ? "Enter how much you want to invest."
      : minimum !== null && comparePaise(amountPaise, minimum) < 0
        ? `The minimum for this fund is ${formatINR(minimum)}.`
        : undefined

  const idempotencyKey = useIdempotencyKey({
    fundId,
    amountPaise: amountPaise ?? "",
  })

  const pending = createOrder.isPending || payOrder.isPending
  const ready = amountError === undefined && consented && !pending

  const describeFailure = (error: unknown): string => {
    if (error instanceof CheckoutUrlRejected) {
      return "The payment page we were sent is not one we will open. Nothing has been charged. Contact support with the reference on this screen."
    }
    if (!isApiError(error)) {
      return "We could not reach the payment service. Nothing has been charged. Check your connection and try again."
    }
    if (error.code === "DEPENDENCY_UNAVAILABLE") {
      return "The payment provider is not available right now. Your order exists; open it from Activity to try paying again."
    }
    if (error.code === "STATE_CONFLICT") {
      return "This order is no longer payable. Open it from Activity to see where it stands."
    }
    return error.message
  }

  const start = (): void => {
    setSubmitted(true)
    setFailure(null)
    if (!ready || amountPaise === null || principal === null) return

    createOrder.mutate(
      { fundId, amountPaise, idempotencyKey },
      {
        onError: (error) => {
          setFailure(describeFailure(error))
        },
        onSuccess: (order) => {
          payOrder.mutate(
            { orderId: order.orderId, idempotencyKey: `${idempotencyKey}-pay` },
            {
              onError: (error) => {
                setFailure(describeFailure(error))
              },
              onSuccess: (outcome) => {
                let decision
                try {
                  decision = decideCheckout(outcome)
                } catch (error) {
                  setFailure(describeFailure(error))
                  return
                }

                if (decision.kind === "terminal") {
                  void navigate("/activity", { replace: true })
                  return
                }

                try {
                  persistPendingPayment(store, {
                    kind: "order_payment",
                    paymentId: decision.paymentId,
                    orderId: order.orderId,
                    ownerId: principal.userId,
                    expiresAt: Date.now() + PENDING_PAYMENT_TTL_MS,
                  })
                } catch {
                  setFailure(
                    "This device would not record the payment, so we stopped before sending you to the payment page. Nothing has been charged. Try again, or use another device.",
                  )
                  return
                }

                if (decision.kind === "poll") {
                  void navigate(`/activity/payments/${decision.paymentId}`, { replace: true })
                  return
                }

                window.location.assign(decision.url)
              },
            },
          )
        },
      },
    )
  }

  return (
    <Page width="form">
      <PageHeader
        title="Invest a lump sum"
        description="You will be handed to PhonePe to pay. Coming back does not confirm the payment; only the settlement does."
      />

      <AsyncBoundary
        query={fund}
        skeleton={
          <Card>
            <Skeleton height="1.4rem" width="60%" />
            <Skeleton height="4rem" />
          </Card>
        }
      >
        {(data) => (
          <div className={FORM}>
            <Card elevated>
              <span className={FUND_LINE}>
                <span className={SECTION_TITLE}>{data.fund.name}</span>
                <span className={META_MUTED}>
                  {data.fund.category}
                  {minimum === null ? "" : ` · minimum ${formatINR(minimum)}`}
                </span>
              </span>

              <div className={AMOUNT_BLOCK}>
                <span className={STAT_LABEL}>Amount</span>
                <AmountInput
                  value={rupees}
                  invalid={submitted && amountError !== undefined}
                  onChange={setRupees}
                  disabled={pending}
                />
                <PresetChoice
                  label="Common amounts"
                  value={Number(rupees)}
                  options={PRESETS}
                  format={(value) => rupeeFormatter.format(value)}
                  onChange={(value) => {
                    setRupees(String(value))
                  }}
                />
                {submitted && amountError !== undefined ? (
                  <span className={FIELD_ERROR}>{amountError}</span>
                ) : (
                  <span className={META_MUTED}>Whole rupees only.</span>
                )}
              </div>

              {amountPaise === null ? null : (
                <>
                  <span className={STAT_LABEL}>You are investing</span>
                  <MoneyValue amount={amountPaise} size="lg" />
                </>
              )}
            </Card>

            <RiskConsent checked={consented} onChange={setConsented} />
            {submitted && !consented ? (
              <span className={FIELD_ERROR}>
                Please confirm you understand the risk before continuing.
              </span>
            ) : null}

            {failure === null ? null : (
              <Alert tone="error" title="We stopped before charging you">
                {failure}
              </Alert>
            )}

            <Button fullWidth loading={pending} onClick={start} trailing>
              Continue to PhonePe
            </Button>

            <Section title="What happens next">
              <ul className={RULES}>
                {[
                  "PhonePe takes the payment. We never see your UPI PIN or card details.",
                  "Returning to the app does not mean the money has moved. We show the payment as pending until the provider confirms it.",
                  "If you close the payment page, the order stays in Activity and expires on its own.",
                  "Submitting twice does not charge you twice. The request carries a key that makes a repeat a replay.",
                ].map((rule) => (
                  <li key={rule} className={RULE}>
                    <span className={RULE_DOT} aria-hidden="true" />
                    {rule}
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default LumpsumInvestScreen
