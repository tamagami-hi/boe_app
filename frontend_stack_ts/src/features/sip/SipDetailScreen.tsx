import { useMemo, useState } from "react"
import { useParams } from "react-router-dom"

import { mintIdempotencyKey } from "~/api/idempotency"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { clientAutoPayStatus, clientSipStatus } from "~/domain/clientStatus"
import { formatDate, formatDateTime } from "~/domain/dates"
import {
  AUTOPAY_NOT_RECORDED,
  PAYMENT_LINK_REJECTED,
  describeClientFailure,
} from "~/domain/failure"
import type { ClientFailure } from "~/domain/failure"
import { toPaise } from "~/domain/money"
import { paymentFailureReason } from "~/domain/paymentReason"
import { CheckoutUrlRejected, decideCheckout } from "~/features/payments/checkout"
import {
  PENDING_PAYMENT_TTL_MS,
  browserPendingPaymentStore,
  persistPendingPayment,
} from "~/features/payments/pendingPayment"
import {
  useAutoPayPlan,
  useCancelAutoPay,
  useFundCatalogue,
  useRetryAutoPaySetup,
  useSipPlans,
  useSipTransition,
} from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Button } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { PROSE_PANEL } from "~/ui/recipes/surface"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { ITEM_TITLE, STAT_LABEL, STAT_ROOT, SUMMARY_GRID } from "~/ui/recipes/datalist"
import { ACTION_DANGER_ROW, ACTION_GROUP, ACTION_ROW } from "~/ui/recipes/layout"
import { HONESTY_TEXT } from "~/ui/recipes/text"

import { SIP_CARD_TOP } from "./sip.recipe"

const MANUAL_EXPLANATION =
  "You pay this plan yourself. Nothing is ever taken automatically — each month an instalment appears in Activity for you to pay."

const AUTOPAY_EXPLANATION =
  "This plan is collected by PhonePe UPI AutoPay. PhonePe lets you know a day before each collection."

type Confirming = "pause" | "resume" | "cancel" | "cancel-autopay" | null

const SipDetailScreen = (): React.ReactElement => {
  const { sipPlanId = "" } = useParams()
  const plans = useSipPlans()
  const funds = useFundCatalogue()
  const { principal } = useSession()
  const transition = useSipTransition()
  const cancelAutoPay = useCancelAutoPay()
  const retrySetup = useRetryAutoPaySetup()
  const [confirming, setConfirming] = useState<Confirming>(null)
  const [failure, setFailure] = useState<ClientFailure | null>(null)
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

  const failureFor = (error: unknown, context: "changeSipPlan" | "cancelAutoPay" | "authoriseAutoPay"): ClientFailure =>
    error instanceof CheckoutUrlRejected ? PAYMENT_LINK_REJECTED : describeClientFailure(error, context)

  const run = (kind: "pause" | "resume" | "cancel"): void => {
    setFailure(null)
    transition.mutate(
      { sipPlanId, transition: kind },
      {
        onError: (error) => {
          setFailure(failureFor(error, "changeSipPlan"))
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
          setFailure(failureFor(error, "cancelAutoPay"))
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
          setFailure(failureFor(error, "authoriseAutoPay"))
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
            setFailure(failureFor(error, "authoriseAutoPay"))
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
            setFailure(AUTOPAY_NOT_RECORDED)
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
      <PageHeader title="SIP plan" description="Your monthly plan and how it is paid." />

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
                  We could not find this plan on your account. It may have been removed.
                </p>
                <ButtonLink to="/sips" tone="secondary">
Back to SIP plans
</ButtonLink>
              </Card>
            )
          }

          const status = clientSipStatus(plan.status)
          const autoPayStatus =
            autopay.data === undefined ? null : clientAutoPayStatus(autopay.data.mandate.status)
          const setupReason = paymentFailureReason(autopay.data?.setup?.failureCode ?? null)

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
                  <span className={ITEM_TITLE}>{nameFor(plan.fundId)}</span>
                  <StatusBadge status={status} />
                </div>
                <span className={STAT_LABEL}>Each month</span>
                <MoneyValue amount={toPaise(plan.amountPaise)} size="xl" />

                <div className={SUMMARY_GRID}>
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Collection day</span>
                    <span className={ITEM_TITLE}>{String(plan.debitDay)}</span>
                  </div>
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Instalments</span>
                    <span className={ITEM_TITLE}>
                      {plan.durationMonths === null
                        ? "Until you stop it"
                        : String(plan.durationMonths)}
                    </span>
                  </div>
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Next instalment</span>
                    <span className={ITEM_TITLE}>
                      {plan.nextDueDate === null ? "Not scheduled" : formatDate(plan.nextDueDate)}
                    </span>
                  </div>
                  <div className={STAT_ROOT}>
                    <span className={STAT_LABEL}>Paid by</span>
                    <span className={ITEM_TITLE}>{isAutoPay ? "AutoPay" : "You, each month"}</span>
                  </div>
                </div>
                {status.detail === undefined ? null : (
                  <p className={HONESTY_TEXT}>{status.detail}</p>
                )}
              </Card>

              <div className={PROSE_PANEL}>
                <p className={HONESTY_TEXT}>
                  {isAutoPay ? AUTOPAY_EXPLANATION : MANUAL_EXPLANATION}
                </p>
              </div>

              {failure === null ? null : (
                <Alert tone="error" title={failure.title}>
                  {failure.message}
                </Alert>
              )}

              {autoPayStatus === null ? null : (
                <Section title="AutoPay">
                  <Card>
                    <DataList>
                      <DetailRow label="Status">
                        <StatusBadge status={autoPayStatus} />
                      </DetailRow>
                      {autopay.data?.mandate.authorizedAt === undefined ||
                      autopay.data.mandate.authorizedAt === null ? null : (
                        <DetailRow label="Set up on">
                          {formatDateTime(autopay.data.mandate.authorizedAt)}
                        </DetailRow>
                      )}
                      {setupReason === null ? null : (
                        <DetailRow label="Reason">{setupReason}</DetailRow>
                      )}
                    </DataList>

                    {autoPayStatus.detail === undefined ? null : (
                      <p className={HONESTY_TEXT}>{autoPayStatus.detail}</p>
                    )}

                    {autopay.data?.canRetrySetup === true ? (
                      <Button loading={retrySetup.isPending} onClick={retry} trailing>
                        Set up AutoPay again
                      </Button>
                    ) : null}
                  </Card>
                </Section>
              )}

              <Section title="Manage this plan">
                <div className={ACTION_GROUP}>
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
                  <ButtonLink to="/activity" tone="ghost">
                    See instalments in Activity
                  </ButtonLink>
                </div>
                {canCancel || canStopMandate ? (
                  <div className={ACTION_DANGER_ROW}>
                    {canCancel ? (
                      <Button
                        tone="danger"
                        disabled={busy}
                        onClick={() => {
                          setConfirming("cancel")
                        }}
                      >
                        Cancel this plan
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
                        Turn off AutoPay
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                </div>
              </Section>

              <ConfirmDialog
                open={confirming === "pause"}
                title="Pause this SIP?"
                description="No instalment is collected while it is paused. You can resume whenever you like."
                confirmLabel="Pause plan"
                cancelLabel="Keep it running"
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
                description="Your next instalment will be collected on your usual collection day."
                confirmLabel="Resume plan"
                cancelLabel="Keep it paused"
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
                description="This cannot be undone. What you have already invested stays invested — only future instalments stop."
                confirmLabel="Cancel plan"
                cancelLabel="Keep plan"
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
                title="Turn off AutoPay?"
                description="We will ask PhonePe to stop collecting. It shows as cancelled once PhonePe confirms."
                confirmLabel="Turn off AutoPay"
                cancelLabel="Keep AutoPay"
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
