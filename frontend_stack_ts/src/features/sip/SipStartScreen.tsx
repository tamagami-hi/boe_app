import { useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { useIdempotencyKey } from "~/api/idempotency"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import {
  AUTOPAY_NOT_RECORDED,
  PAYMENT_LINK_REJECTED,
  describeClientFailure,
} from "~/domain/failure"
import type { ClientFailure } from "~/domain/failure"
import { comparePaise, formatINR, rupeesToPaise, toPaise } from "~/domain/money"
import type { Paise } from "~/domain/money"
import { CheckoutUrlRejected, decideCheckout } from "~/features/payments/checkout"
import {
  PENDING_PAYMENT_TTL_MS,
  browserPendingPaymentStore,
  persistPendingPayment,
} from "~/features/payments/pendingPayment"
import { useCreateSip, useFund, useStartAutoPay } from "~/features/shared/queries"
import { isNative } from "~/platform/capacitor"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { AmountInput } from "~/ui/primitives/AmountInput"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { CARD_SECTION } from "~/ui/recipes/surface"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { FormActions } from "~/ui/primitives/Form"
import { PresetChoice, RadioGroup } from "~/ui/primitives/Toggle"
import { ITEM_TITLE, STAT_LABEL, STAT_ROOT, SUMMARY_GRID } from "~/ui/recipes/datalist"
import { FIELD_ERROR, FORM_ROOT } from "~/ui/recipes/field"
import { HONESTY_TEXT, META_MUTED } from "~/ui/recipes/text"

import { SIP_FIELD, SIP_HINT } from "./sip.recipe"

const AUTOPAY_MAX_RUPEES = 15_000
const AUTOPAY_MAX_MONTHS = 360
const MANUAL_MAX_MONTHS = 600

const DURATIONS = [12, 24, 36, 60, 120] as const
const DEBIT_DAYS = [1, 5, 10, 15, 20, 25] as const

type Mode = "manual_checkout" | "phonepe_autopay"

const SipStartScreen = (): React.ReactElement => {
  const { fundId = "" } = useParams()
  const fund = useFund(fundId)
  const navigate = useNavigate()
  const { principal } = useSession()
  const createSip = useCreateSip()
  const startAutoPay = useStartAutoPay()

  const [mode, setMode] = useState<Mode>("manual_checkout")
  const [rupees, setRupees] = useState("")
  const [durationMonths, setDurationMonths] = useState<number>(12)
  const [debitDay, setDebitDay] = useState<number>(1)
  const [submitted, setSubmitted] = useState(false)
  const [failure, setFailure] = useState<ClientFailure | null>(null)
  const store = useMemo(browserPendingPaymentStore, [])

  const minimum: Paise | null = useMemo(() => {
    const raw = fund.data?.fund.minimumSipPaise ?? null
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

  const maxMonths = mode === "phonepe_autopay" ? AUTOPAY_MAX_MONTHS : MANUAL_MAX_MONTHS
  const overAutoPayCap = mode === "phonepe_autopay" && Number(rupees) > AUTOPAY_MAX_RUPEES

  const amountError =
    amountPaise === null
      ? "Enter how much to invest each month."
      : minimum !== null && comparePaise(amountPaise, minimum) < 0
        ? `The minimum for this fund is ${formatINR(minimum)} a month.`
        : overAutoPayCap
          ? `AutoPay is limited to ₹${AUTOPAY_MAX_RUPEES.toLocaleString("en-IN")} a month. Choose manual payments for more.`
          : undefined

  const durationError =
    durationMonths < 1 || durationMonths > maxMonths
      ? `Choose a length between 1 and ${String(maxMonths)} months.`
      : undefined

  const idempotencyKey = useIdempotencyKey({
    fundId,
    amountPaise: amountPaise ?? "",
    debitDay,
    durationMonths,
  })

  const pending = createSip.isPending || startAutoPay.isPending
  const ready = amountError === undefined && durationError === undefined && !pending

  const describeFailure = (error: unknown): ClientFailure =>
    error instanceof CheckoutUrlRejected
      ? PAYMENT_LINK_REJECTED
      : describeClientFailure(error, mode === "phonepe_autopay" ? "authoriseAutoPay" : "createSip")

  const start = (): void => {
    setSubmitted(true)
    setFailure(null)
    if (!ready || amountPaise === null || principal === null) return

    if (mode === "manual_checkout") {
      createSip.mutate(
        { fundId, amountPaise, debitDay, durationMonths },
        {
          onError: (error) => {
            setFailure(describeFailure(error))
          },
          onSuccess: (plan) => {
            void navigate(`/sips/${plan.sipId}`, { replace: true })
          },
        },
      )
      return
    }

    startAutoPay.mutate(
      { fundId, amountPaise, debitDay, durationMonths, idempotencyKey },
      {
        onError: (error) => {
          setFailure(describeFailure(error))
        },
        onSuccess: (setup) => {
          let decision
          try {
            decision = decideCheckout({
              orderId: setup.orderId,
              status: setup.status,
              paymentId: setup.paymentId,
              checkout: setup.checkout,
            })
          } catch (error) {
            setFailure(describeFailure(error))
            return
          }

          if (decision.kind === "redirect") {
            try {
              persistPendingPayment(store, {
                kind: "mandate_setup",
                paymentId: decision.paymentId,
                orderId: setup.orderId,
                sipPlanId: setup.sipPlanId,
                ownerId: principal.userId,
                expiresAt: Date.now() + PENDING_PAYMENT_TTL_MS,
              })
            } catch {
              setFailure(AUTOPAY_NOT_RECORDED)
              return
            }
            window.location.assign(decision.url)
            return
          }
          void navigate(`/sips/${setup.sipPlanId}`, { replace: true })
        },
      },
    )
  }

  return (
    <Page width="form">
      <PageHeader
        title="Start a SIP"
        description="Invest the same amount in this fund every month."
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
                <span className={ITEM_TITLE}>{data.fund.name}</span>
                <span className={META_MUTED}>
                  {data.fund.category}
                  {minimum === null ? "" : ` · minimum ${formatINR(minimum)} a month`}
                </span>

                <div className={SIP_FIELD}>
                  <span className={STAT_LABEL}>Monthly amount</span>
                  <AmountInput
                    value={rupees}
                    invalid={submitted && amountError !== undefined}
                    onChange={setRupees}
                    disabled={pending}
                  />
                  {submitted && amountError !== undefined ? (
                    <span className={FIELD_ERROR}>{amountError}</span>
                  ) : (
                    <span className={SIP_HINT}>Whole rupees only.</span>
                  )}
                </div>
              <div className={CARD_SECTION}>
                <span className={STAT_LABEL}>How it is paid</span>
                <RadioGroup<Mode>
                  legend="How the SIP is paid"
                  value={mode}
                  onChange={setMode}
                  options={[
                    {
                      value: "manual_checkout",
                      label: "Pay each month myself",
                      hint: "Nothing is taken automatically. Each month you get an instalment to pay in Activity, just like a one-off investment.",
                    },
                    {
                      value: "phonepe_autopay",
                      label: "PhonePe UPI AutoPay",
                      hint: isNative()
                        ? "Authorise once, then each instalment is collected on your chosen day. PhonePe tells you a day before. Up to ₹15,000 a month."
                        : "Setting up AutoPay needs the BeOnEdge Android app. You can choose it here and finish the setup there.",
                    },
                  ]}
                />
              </div>

              <div className={CARD_SECTION}>
                <div className={SIP_FIELD}>
                  <span className={STAT_LABEL}>For how long</span>
                  <PresetChoice
                    label="Duration in months"
                    value={durationMonths}
                    options={DURATIONS}
                    format={(value) => `${String(value)} mo`}
                    onChange={setDurationMonths}
                  />
                  {submitted && durationError !== undefined ? (
                    <span className={FIELD_ERROR}>{durationError}</span>
                  ) : null}
                </div>

                <div className={SIP_FIELD}>
                  <span className={STAT_LABEL}>Collection day</span>
                  <PresetChoice
                    label="Day of the month"
                    value={debitDay}
                    options={DEBIT_DAYS}
                    format={(value) => String(value)}
                    onChange={setDebitDay}
                  />
                  <span className={SIP_HINT}>
                    The day each month your instalment is collected.
                  </span>
                </div>
              </div>

              {amountPaise === null ? null : (
                <div className={CARD_SECTION}>
                  <span className={STAT_LABEL}>Each month</span>
                  <MoneyValue amount={amountPaise} size="lg" />
                  <div className={SUMMARY_GRID}>
                    <div className={STAT_ROOT}>
                      <span className={STAT_LABEL}>Instalments</span>
                      <span className={ITEM_TITLE}>{String(durationMonths)}</span>
                    </div>
                    <div className={STAT_ROOT}>
                      <span className={STAT_LABEL}>Collection day</span>
                      <span className={ITEM_TITLE}>{String(debitDay)}</span>
                    </div>
                    <div className={STAT_ROOT}>
                      <span className={STAT_LABEL}>Paid by</span>
                      <span className={ITEM_TITLE}>
                        {mode === "manual_checkout" ? "You, each month" : "AutoPay"}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              </Card>

              {failure === null ? null : (
                <Alert tone="error" title={failure.title}>
                  {failure.message}
                </Alert>
              )}

              <FormActions>
                <Button fullWidth loading={pending} onClick={start} trailing>
                  {mode === "manual_checkout" ? "Create the SIP" : "Set up AutoPay"}
                </Button>
              </FormActions>
            </div>
          )}
        </AsyncBoundary>

        <Section title="Worth knowing">
          <p className={HONESTY_TEXT}>
            A SIP does not remove risk and it does not promise a return. It commits you to a
            monthly amount, and you can pause or stop it at any time.
          </p>
        </Section>
    </Page>
  )
}

export default SipStartScreen
