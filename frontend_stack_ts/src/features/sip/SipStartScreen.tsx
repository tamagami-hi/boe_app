import { useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { isApiError } from "~/api/errors"
import { useIdempotencyKey } from "~/api/idempotency"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { DEBIT_DAY_MAX, DEBIT_DAY_MIN } from "~/domain/dates"
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
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { PresetChoice, RadioGroup } from "~/ui/primitives/Toggle"
import { ITEM_TITLE, STAT_LABEL, STAT_ROOT } from "~/ui/recipes/datalist"
import { FIELD_ERROR } from "~/ui/recipes/field"
import { HONESTY_TEXT, META_MUTED, SECTION_TITLE } from "~/ui/recipes/text"

import { SIP_FIELD, SIP_FORM, SIP_HINT, SIP_SUMMARY } from "./sip.recipe"

const AUTOPAY_MAX_RUPEES = 15_000
const AUTOPAY_MAX_MONTHS = 360
const MANUAL_MAX_MONTHS = 600

const DURATIONS = [12, 24, 36, 60, 120] as const
const DEBIT_DAYS = [1, 5, 10, 15, 20, 25] as const

type Mode = "manual_checkout" | "phonepe_autopay"

type Failure = Readonly<{ title: string; body: string }>

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
  const [failure, setFailure] = useState<Failure | null>(null)
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
          ? `AutoPay mandates are capped at ₹${AUTOPAY_MAX_RUPEES.toLocaleString("en-IN")} a month. Use manual checkout for more.`
          : undefined

  const durationError =
    durationMonths < 1 || durationMonths > maxMonths
      ? `Choose between 1 and ${String(maxMonths)} months.`
      : undefined

  const idempotencyKey = useIdempotencyKey({
    fundId,
    amountPaise: amountPaise ?? "",
    debitDay,
    durationMonths,
  })

  const pending = createSip.isPending || startAutoPay.isPending
  const ready = amountError === undefined && durationError === undefined && !pending

  const describeFailure = (error: unknown): string => {
    if (error instanceof CheckoutUrlRejected) {
      return "The mandate page we were sent is not one we will open. No mandate has been authorised."
    }
    if (!isApiError(error)) {
      return "We could not reach the service. No SIP has been created."
    }
    if (error.code === "DEPENDENCY_UNAVAILABLE") {
      return "AutoPay is not configured in this environment. Manual checkout still works: a due installment becomes an ordinary payable order."
    }
    if (error.code === "STATE_CONFLICT") {
      return "This fund cannot take a SIP right now, or your account is not yet eligible."
    }
    return error.message
  }

  const start = (): void => {
    setSubmitted(true)
    setFailure(null)
    if (!ready || amountPaise === null || principal === null) return

    if (mode === "manual_checkout") {
      createSip.mutate(
        { fundId, amountPaise, debitDay, durationMonths },
        {
          onError: (error) => {
            setFailure({ title: "Nothing was created", body: describeFailure(error) })
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
          setFailure({ title: "Nothing was created", body: describeFailure(error) })
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
            setFailure({ title: "Nothing was created", body: describeFailure(error) })
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
              setFailure({
                title: "We stopped before the mandate page",
                body: "This device would not record the authorisation, so we did not send you to PhonePe. No mandate has been authorised and nothing has been debited. The plan exists and is waiting for authorisation — open it under SIP plans, or try again on another device.",
              })
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
        description="A standing plan to invest the same amount every month. You choose how it is paid."
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
          <div className={SIP_FORM}>
            <Card elevated>
              <span className={SECTION_TITLE}>{data.fund.name}</span>
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
            </Card>

            <Card>
              <span className={STAT_LABEL}>How it is paid</span>
              <RadioGroup<Mode>
                legend="How the SIP is paid"
                value={mode}
                onChange={setMode}
                options={[
                  {
                    value: "manual_checkout",
                    label: "Manual checkout",
                    hint: "Nothing is ever debited automatically. Each month's installment becomes an ordinary payable order in Activity and you pay it like a lump sum.",
                  },
                  {
                    value: "phonepe_autopay",
                    label: "PhonePe UPI AutoPay",
                    hint: isNative()
                      ? "You authorise a mandate once. PhonePe notifies you 24 hours ahead and debits at 10:00 IST. Capped at ₹15,000 a month."
                      : "Authorising a mandate needs the Android app. You can still choose it here, but the authorisation step will ask you to continue on the app.",
                  },
                ]}
              />
            </Card>

            <Card>
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
                <span className={STAT_LABEL}>Debit day</span>
                <PresetChoice
                  label="Day of the month"
                  value={debitDay}
                  options={DEBIT_DAYS}
                  format={(value) => String(value)}
                  onChange={setDebitDay}
                />
                <span className={SIP_HINT}>
                  Any day from {String(DEBIT_DAY_MIN)} to {String(DEBIT_DAY_MAX)}. Later days do not
                  exist in every month, so we do not offer them.
                </span>
              </div>
            </Card>

            {amountPaise === null ? null : (
              <Card>
                <span className={STAT_LABEL}>Each month</span>
                <MoneyValue amount={amountPaise} size="lg" />
                <div className={SIP_SUMMARY}>
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Installments</span>
                    <span className={ITEM_TITLE}>{String(durationMonths)}</span>
                  </div>
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Debit day</span>
                    <span className={ITEM_TITLE}>{String(debitDay)}</span>
                  </div>
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Mode</span>
                    <span className={ITEM_TITLE}>
                      {mode === "manual_checkout" ? "Manual" : "AutoPay"}
                    </span>
                  </div>
                </div>
              </Card>
            )}

            {failure === null ? null : (
              <Alert tone="error" title={failure.title}>
                {failure.body}
              </Alert>
            )}

            <Button fullWidth loading={pending} onClick={start} trailing>
              {mode === "manual_checkout" ? "Create the SIP" : "Authorise the mandate"}
            </Button>

            <Section title="What a SIP does not do">
              <p className={HONESTY_TEXT}>
                A SIP does not average away risk and it does not promise a return. It commits you to
                a monthly amount you can stop at any time. Returning from the UPI app does not mean a
                mandate was authorised — only the mandate state we hold does.
              </p>
            </Section>
          </div>
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default SipStartScreen
