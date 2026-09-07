import { useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { useIdempotencyKey } from "~/api/idempotency"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import {
  PAYMENT_LINK_REJECTED,
  PAYMENT_NOT_RECORDED,
  describeClientFailure,
} from "~/domain/failure"
import type { ClientFailure } from "~/domain/failure"
import { comparePaise, formatINR, formatRupees, rupeesToPaise, toPaise } from "~/domain/money"
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
import { FIELD_ERROR, FORM_ROOT } from "~/ui/recipes/field"
import { META_MUTED, SECTION_TITLE } from "~/ui/recipes/text"
import { AmountInput } from "~/ui/primitives/AmountInput"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { FormActions } from "~/ui/primitives/Form"
import { PresetChoice } from "~/ui/primitives/Toggle"

import { RiskConsent } from "./RiskConsent"

import { AMOUNT_BLOCK, FUND_LINE, RULE, RULES, RULE_DOT } from "./orders.recipe"

const PRESETS = [1_000, 5_000, 10_000, 25_000, 50_000] as const

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
  const [failure, setFailure] = useState<ClientFailure | null>(null)
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

  const describeFailure = (error: unknown, stage: "createInvestmentOrder" | "payInvestmentOrder"): ClientFailure =>
    error instanceof CheckoutUrlRejected
      ? PAYMENT_LINK_REJECTED
      : describeClientFailure(error, stage)

  const start = (): void => {
    setSubmitted(true)
    setFailure(null)
    if (!ready || amountPaise === null || principal === null) return

    createOrder.mutate(
      { fundId, amountPaise, idempotencyKey },
      {
        onError: (error) => {
          setFailure(describeFailure(error, "createInvestmentOrder"))
        },
        onSuccess: (order) => {
          payOrder.mutate(
            { orderId: order.orderId, idempotencyKey: `${idempotencyKey}-pay` },
            {
              onError: (error) => {
                setFailure(describeFailure(error, "payInvestmentOrder"))
              },
              onSuccess: (outcome) => {
                let decision
                try {
                  decision = decideCheckout(outcome)
                } catch (error) {
                  setFailure(describeFailure(error, "payInvestmentOrder"))
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
                  setFailure(PAYMENT_NOT_RECORDED)
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
        description="A one-off investment in this fund, paid securely through PhonePe."
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
          <div className={FORM_ROOT}>
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
                    format={(value) => formatRupees(value)}
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
                <Alert tone="error" title={failure.title}>
                  {failure.message}
                </Alert>
              )}

              <FormActions>
                <Button fullWidth loading={pending} onClick={start} trailing>
                  Continue to PhonePe
                </Button>
              </FormActions>
            </div>
          )}
        </AsyncBoundary>

        <Section title="What happens next">
          <ul className={RULES}>
            {[
              "PhonePe handles the payment. We never see your UPI PIN or card details.",
              "You can follow the payment in Activity until it is confirmed.",
              "Tapping twice will not charge you twice.",
            ].map((rule) => (
              <li key={rule} className={RULE}>
                <span className={RULE_DOT} aria-hidden="true" />
                {rule}
              </li>
            ))}
          </ul>
        </Section>
    </Page>
  )
}

export default LumpsumInvestScreen
