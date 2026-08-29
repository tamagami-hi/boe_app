import { useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"

import { isApiError } from "~/api/errors"
import { mintIdempotencyKey } from "~/api/idempotency"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDate, formatDateTime } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { mandateSetupState, mandateState, sipState } from "~/domain/status"
import { CheckoutUrlRejected, decideCheckout } from "~/features/payments/checkout"
import {
  PENDING_PAYMENT_TTL_MS,
  browserPendingPaymentStore,
  persistPendingPayment,
} from "~/features/payments/pendingPayment"
import {
  useAutoPayPlan,
  useCancelAutoPay,
  useFunds,
  useRetryAutoPaySetup,
  useSipPlans,
  useSipTransition,
} from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { ITEM_TITLE, STAT_LABEL, STAT_ROOT } from "~/ui/recipes/datalist"
import { ACTION_ROW } from "~/ui/recipes/layout"
import { HONESTY_TEXT, SECTION_TITLE } from "~/ui/recipes/text"

import { SIP_CARD_TOP, SIP_SUMMARY } from "./sip.recipe"

const MANUAL_HONESTY =
  "This plan is paid manually. Nothing is ever debited automatically. On the debit day the backend creates an ordinary payable order, it appears in Activity, and you pay it like any lump sum."

const AUTOPAY_HONESTY =
  "This plan is paid by a PhonePe UPI AutoPay mandate. PhonePe notifies you 24 hours before each debit and collects at 10:00 IST, with a 48-hour collection window. Returning from the UPI app does not authorise anything on its own — only the mandate state below does."

type Confirming = "pause" | "resume" | "cancel" | "cancel-autopay" | null

type Failure = Readonly<{ title: string; body: string }>

const SipDetailScreen = (): React.ReactElement => {
  const { sipPlanId = "" } = useParams()
  const plans = useSipPlans()
  const funds = useFunds()
  const { principal } = useSession()
  const transition = useSipTransition()
  const cancelAutoPay = useCancelAutoPay()
  const retrySetup = useRetryAutoPaySetup()
  const [confirming, setConfirming] = useState<Confirming>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const store = useMemo(browserPendingPaymentStore, [])

  const plan = plans.data?.items.find((entry) => entry.sipId === sipPlanId) ?? null
  const looksAutoPay =
    plan !== null &&
    ["pending_mandate", "cancel_pending", "setup_failed", "mandate_failed", "revoked"].includes(
      plan.status,
    )
  const autopay = useAutoPayPlan(sipPlanId, plan !== null)
  const isAutoPay = autopay.data !== undefined || looksAutoPay

  const nameFor = (fundId: string): string =>
    funds.data?.items.find((fund) => fund.id === fundId)?.name ?? "Fund"

  const describeFailure = (error: unknown): string => {
    if (error instanceof CheckoutUrlRejected) {
      return "The mandate page we were sent is not one we will open."
    }
    if (!isApiError(error)) return "We could not reach the service. Nothing changed."
    if (error.code === "DEPENDENCY_UNAVAILABLE") {
      return "PhonePe is not configured in this environment, so mandate actions are unavailable here."
    }
    if (error.code === "STATE_CONFLICT") {
      return "This plan is not in a state that allows that. Reload to see where it stands."
    }
    return error.message
  }

  const run = (kind: "pause" | "resume" | "cancel"): void => {
    setFailure(null)
    transition.mutate(
      { sipPlanId, transition: kind },
      {
        onError: (error) => {
          setFailure({ title: "Nothing changed", body: describeFailure(error) })
        },
        onSettled: () => {
          setConfirming(null)
        },
      },
    )
  }

  const stopMandate = (): void => {
    setFailure(null)
    cancelAutoPay.mutate(
      { sipPlanId, idempotencyKey: mintIdempotencyKey() },
      {
        onError: (error) => {
          setFailure({ title: "Nothing changed", body: describeFailure(error) })
        },
        onSettled: () => {
          setConfirming(null)
        },
      },
    )
  }

  const retry = (): void => {
    setFailure(null)
    if (principal === null) return
    retrySetup.mutate(
      { sipPlanId, idempotencyKey: mintIdempotencyKey() },
      {
        onError: (error) => {
          setFailure({ title: "Nothing changed", body: describeFailure(error) })
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
            setFailure({ title: "Nothing changed", body: describeFailure(error) })
            return
          }
          if (decision.kind !== "redirect") return

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
              body: "This device would not record the authorisation, so we did not send you to PhonePe. No mandate has been authorised and nothing has been debited. This attempt now has to expire before another one can start; try again on another device.",
            })
            return
          }
          window.location.assign(decision.url)
        },
      },
    )
  }

  const busy = transition.isPending || cancelAutoPay.isPending || retrySetup.isPending

  return (
    <Page width="default">
      <PageHeader
        title="SIP plan"
        description="Everything this plan does, and everything you can do to it."
      />

      <AsyncBoundary
        query={plans}
        skeleton={
          <Card>
            <Skeleton height="1.2rem" width="50%" />
            <Skeleton height="2.4rem" width="60%" />
          </Card>
        }
      >
        {() => {
          if (plan === null) {
            return (
              <Card>
                <p className={HONESTY_TEXT}>
                  This plan is not on your account, or it has been removed.
                </p>
                <Link to="/sips">
                  <Button tone="secondary">Back to SIP plans</Button>
                </Link>
              </Card>
            )
          }

          const canPause = plan.status === "active" && !isAutoPay
          const canResume = plan.status === "paused" && !isAutoPay
          const canCancel = (plan.status === "active" || plan.status === "paused") && !isAutoPay
          const canStopMandate =
            isAutoPay &&
            ["pending_mandate", "active", "paused"].includes(plan.status) &&
            autopay.data?.mandate.status !== "cancelled"

          return (
            <>
              <Card elevated>
                <div className={SIP_CARD_TOP}>
                  <span className={SECTION_TITLE}>{nameFor(plan.fundId)}</span>
                  <StatusBadge status={sipState(plan.status)} />
                </div>
                <span className={STAT_LABEL}>Each month</span>
                <MoneyValue amount={toPaise(plan.amountPaise)} size="xl" />

                <div className={SIP_SUMMARY}>
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Debit day</span>
                    <span className={ITEM_TITLE}>{String(plan.debitDay)}</span>
                  </div>
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Installments</span>
                    <span className={ITEM_TITLE}>
                      {plan.durationMonths === null ? "Open" : String(plan.durationMonths)}
                    </span>
                  </div>
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Next due</span>
                    <span className={ITEM_TITLE}>
                      {plan.nextDueDate === null ? "—" : formatDate(plan.nextDueDate)}
                    </span>
                  </div>
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Mode</span>
                    <span className={ITEM_TITLE}>{isAutoPay ? "AutoPay" : "Manual"}</span>
                  </div>
                </div>
              </Card>

              <Card>
                <p className={HONESTY_TEXT}>{isAutoPay ? AUTOPAY_HONESTY : MANUAL_HONESTY}</p>
              </Card>

              {failure === null ? null : (
                <Alert tone="error" title={failure.title}>
                  {failure.body}
                </Alert>
              )}

              {autopay.data === undefined ? null : (
                <Section title="Mandate">
                  <Card>
                    <DataList>
                      <DetailRow label="Mandate">
                        <StatusBadge status={mandateState(autopay.data.mandate.status)} />
                      </DetailRow>
                      {autopay.data.mandate.authorizedAt === null ? null : (
                        <DetailRow label="Authorised">
                          {formatDateTime(autopay.data.mandate.authorizedAt)}
                        </DetailRow>
                      )}
                      {autopay.data.setup === null ? null : (
                        <DetailRow label="Latest setup attempt">
                          <StatusBadge status={mandateSetupState(autopay.data.setup.status)} />
                        </DetailRow>
                      )}
                      {autopay.data.setup?.failureCode === null ||
                      autopay.data.setup === null ? null : (
                        <DetailRow label="Reported reason">
                          {autopay.data.setup.failureCode}
                        </DetailRow>
                      )}
                      {autopay.data.cancellation === null ? null : (
                        <DetailRow label="Cancellation">
                          {autopay.data.cancellation.status}
                        </DetailRow>
                      )}
                    </DataList>

                    {autopay.data.canRetrySetup ? (
                      <Button loading={retrySetup.isPending} onClick={retry} trailing>
                        Authorise the mandate again
                      </Button>
                    ) : null}
                  </Card>
                </Section>
              )}

              <Section title="Manage this plan">
                <div className={ACTION_ROW}>
                  {canPause ? (
                    <Button
                      tone="secondary"
                      disabled={busy}
                      onClick={() => {
                        setConfirming("pause")
                      }}
                    >
                      Pause
                    </Button>
                  ) : null}
                  {canResume ? (
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setConfirming("resume")
                      }}
                    >
                      Resume
                    </Button>
                  ) : null}
                  {canCancel ? (
                    <Button
                      tone="danger"
                      disabled={busy}
                      onClick={() => {
                        setConfirming("cancel")
                      }}
                    >
                      Cancel the plan
                    </Button>
                  ) : null}
                  {canStopMandate ? (
                    <Button
                      tone="danger"
                      disabled={busy}
                      onClick={() => {
                        setConfirming("cancel-autopay")
                      }}
                    >
                      Cancel the mandate
                    </Button>
                  ) : null}
                  <Link to="/activity">
                    <Button tone="ghost">See installments in Activity</Button>
                  </Link>
                </div>
              </Section>

              <ConfirmDialog
                open={confirming === "pause"}
                title="Pause this SIP?"
                description="No installment is created while it is paused. You can resume at any time and nothing is lost."
                confirmLabel="Pause it"
                pending={transition.isPending}
                onConfirm={() => {
                  run("pause")
                }}
                onCancel={() => {
                  setConfirming(null)
                }}
              />

              <ConfirmDialog
                open={confirming === "resume"}
                title="Resume this SIP?"
                description="The next installment is created on the next debit day."
                confirmLabel="Resume it"
                pending={transition.isPending}
                onConfirm={() => {
                  run("resume")
                }}
                onCancel={() => {
                  setConfirming(null)
                }}
              />

              <ConfirmDialog
                open={confirming === "cancel"}
                title="Cancel this SIP?"
                description="Cancelling is permanent. What you have already invested stays invested; only future installments stop."
                confirmLabel="Cancel the plan"
                confirmTone="danger"
                pending={transition.isPending}
                onConfirm={() => {
                  run("cancel")
                }}
                onCancel={() => {
                  setConfirming(null)
                }}
              />

              <ConfirmDialog
                open={confirming === "cancel-autopay"}
                title="Cancel this mandate?"
                description="We ask PhonePe to revoke the mandate. Until PhonePe confirms, the mandate shows as cancellation pending — it is not cancelled because this screen says so."
                confirmLabel="Cancel the mandate"
                confirmTone="danger"
                pending={cancelAutoPay.isPending}
                onConfirm={stopMandate}
                onCancel={() => {
                  setConfirming(null)
                }}
              />
            </>
          )
        }}
      </AsyncBoundary>
    </Page>
  )
}

export default SipDetailScreen
