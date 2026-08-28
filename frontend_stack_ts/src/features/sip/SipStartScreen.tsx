import { useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { isApiError } from "~/api/errors"
import { useIdempotencyKey } from "~/api/idempotency"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { DEBIT_DAY_MAX, DEBIT_DAY_MIN } from "~/domain/dates"
import { comparePaise, formatINR, rupeesToPaise, toPaise } from "~/domain/money"
import type { Paise } from "~/domain/money"
import { CheckoutUrlRejected, decideCheckout } from "~/features/payments/checkout"
import { useCreateSip, useFund, useStartAutoPay } from "~/features/shared/queries"
import { isNative } from "~/platform/capacitor"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { AmountInput } from "~/ui/primitives/AmountInput"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { PresetChoice, RadioGroup } from "~/ui/primitives/Toggle"

import styles from "./Sip.module.css"

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
  const createSip = useCreateSip()
  const startAutoPay = useStartAutoPay()

  const [mode, setMode] = useState<Mode>("manual_checkout")
  const [rupees, setRupees] = useState("")
  const [durationMonths, setDurationMonths] = useState<number>(12)
  const [debitDay, setDebitDay] = useState<number>(1)
  const [submitted, setSubmitted] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

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
    if (!ready || amountPaise === null) return

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
          <div className={styles.form}>
            <Card elevated>
              <span className={styles.fundName}>{data.fund.name}</span>
              <span className={styles.fundMeta}>
                {data.fund.category}
                {minimum === null ? "" : ` · minimum ${formatINR(minimum)} a month`}
              </span>

              <div className={styles.field}>
                <span className={styles.label}>Monthly amount</span>
                <AmountInput
                  value={rupees}
                  invalid={submitted && amountError !== undefined}
                  onChange={setRupees}
                  disabled={pending}
                />
                {submitted && amountError !== undefined ? (
                  <span className={styles.error}>{amountError}</span>
                ) : (
                  <span className={styles.hint}>Whole rupees only.</span>
                )}
              </div>
            </Card>

            <Card>
              <span className={styles.label}>How it is paid</span>
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
              <div className={styles.field}>
                <span className={styles.label}>For how long</span>
                <PresetChoice
                  label="Duration in months"
                  value={durationMonths}
                  options={DURATIONS}
                  format={(value) => `${String(value)} mo`}
                  onChange={setDurationMonths}
                />
                {submitted && durationError !== undefined ? (
                  <span className={styles.error}>{durationError}</span>
                ) : null}
              </div>

              <div className={styles.field}>
                <span className={styles.label}>Debit day</span>
                <PresetChoice
                  label="Day of the month"
                  value={debitDay}
                  options={DEBIT_DAYS}
                  format={(value) => String(value)}
                  onChange={setDebitDay}
                />
                <span className={styles.hint}>
                  Any day from {String(DEBIT_DAY_MIN)} to {String(DEBIT_DAY_MAX)}. Later days do not
                  exist in every month, so we do not offer them.
                </span>
              </div>
            </Card>

            {amountPaise === null ? null : (
              <Card>
                <span className={styles.label}>Each month</span>
                <MoneyValue amount={amountPaise} size="lg" />
                <div className={styles.summary}>
                  <div>
                    <span className={styles.label}>Installments</span>
                    <span className={styles.name}>{String(durationMonths)}</span>
                  </div>
                  <div>
                    <span className={styles.label}>Debit day</span>
                    <span className={styles.name}>{String(debitDay)}</span>
                  </div>
                  <div>
                    <span className={styles.label}>Mode</span>
                    <span className={styles.name}>
                      {mode === "manual_checkout" ? "Manual" : "AutoPay"}
                    </span>
                  </div>
                </div>
              </Card>
            )}

            {failure === null ? null : (
              <Alert tone="error" title="Nothing was created">
                {failure}
              </Alert>
            )}

            <Button fullWidth loading={pending} onClick={start} trailing>
              {mode === "manual_checkout" ? "Create the SIP" : "Authorise the mandate"}
            </Button>

            <Section title="What a SIP does not do">
              <p className={styles.honesty}>
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
