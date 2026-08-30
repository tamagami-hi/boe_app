import { useState } from "react"
import { useParams } from "react-router-dom"

import { isApiError } from "~/api/errors"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDate, formatDateTime } from "~/domain/dates"
import { mandateSetupState, mandateState, sipState } from "~/domain/status"
import { useAdminMandate, useMandateAction } from "~/features/admin/shared/adminQueries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"

import { ADMIN_CODE, ADMIN_FIGURE } from "~/ui/recipes/admin"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW } from "~/ui/recipes/layout"

const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
})

type Confirming = "reconcile" | "cancel" | null

const MandateDetailScreen = (): React.ReactElement => {
  const { mandateId = "" } = useParams()
  const query = useAdminMandate(mandateId)
  const action = useMandateAction(mandateId)
  const { hasAnyPermission } = useSession()
  const [reason, setReason] = useState("")
  const [confirming, setConfirming] = useState<Confirming>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const canOperate = hasAnyPermission(["finance.operate"])
  const reasonMissing = reason.trim() === ""

  const run = (kind: "reconcile" | "cancel"): void => {
    setFailure(null)
    action.mutate(
      { action: kind, reason: reason.trim() },
      {
        onError: (error) => {
          setFailure(
            isApiError(error)
              ? error.code === "DEPENDENCY_UNAVAILABLE"
                ? "PhonePe is not reachable from this environment, so this cannot be done here."
                : error.code === "STATE_CONFLICT"
                  ? "This mandate is not in a state that allows that, or it changed while you were looking at it."
                  : error.message
              : "We could not do that. Nothing has changed.",
          )
        },
        onSuccess: () => {
          setReason("")
        },
        onSettled: () => {
          setConfirming(null)
        },
      },
    )
  }

  return (
    <Page width="wide">
      <PageHeader
        title="Mandate"
        description="What PhonePe holds for this mandate, every setup attempt, every collection attempt, and every cancellation command."
      />

      <AsyncBoundary
        query={query}
        notConfigured
        skeleton={
          <Card>
            <Skeleton height="1.2rem" width="45%" />
            <Skeleton height="3rem" />
          </Card>
        }
      >
        {(data) => (
          <>
            {failure === null ? null : (
              <Alert tone="error" title="Nothing changed">
                {failure}
              </Alert>
            )}

            <Card elevated>
              <DataList split>
                <DetailRow label="Investor">{data.user.name ?? "—"}</DetailRow>
                <DetailRow label="Email">{data.user.email ?? "—"}</DetailRow>
                <DetailRow label="Fund">{data.fund.name ?? "—"}</DetailRow>
                <DetailRow label="Monthly amount">
                  <span className={ADMIN_FIGURE}>
                    {rupees.format(data.mandate.amountPaise / 100)}
                  </span>
                </DetailRow>
                <DetailRow label="Debit day">{String(data.sip.debitDay)}</DetailRow>
                <DetailRow label="Mandate">
                  <StatusBadge status={mandateState(data.mandate.state)} />
                </DetailRow>
                <DetailRow label="SIP">
                  <StatusBadge status={sipState(data.sip.state)} />
                </DetailRow>
                <DetailRow label="Collection mode">{data.sip.collectionMode}</DetailRow>
                <DetailRow label="Merchant subscription">
                  <span className={ADMIN_CODE}>{data.mandate.merchantSubscriptionId}</span>
                </DetailRow>
                <DetailRow label="Provider subscription">
                  <span className={ADMIN_CODE}>
                    {data.mandate.providerSubscriptionId ?? "not issued"}
                  </span>
                </DetailRow>
                <DetailRow label="Reported reason">
                  {data.mandate.failureCode ?? "—"}
                </DetailRow>
                <DetailRow label="Last checked with provider">
                  {data.mandate.lastStatusCheckedAt === null
                    ? "never"
                    : formatDateTime(data.mandate.lastStatusCheckedAt)}
                </DetailRow>
              </DataList>
            </Card>

            <Section
              title="Act on this mandate"
              description="Reconciling asks PhonePe for the mandate's real state and records the answer. Cancelling queues a revocation request; the mandate is not cancelled until PhonePe confirms it."
            >
              <Card>
                {canOperate ? (
                  <>
                    <FormField
                      label="Reason"
                      required
                      hint="Recorded in the audit log against this mandate."
                      {...(reasonMissing && confirming !== null
                        ? { error: "A reason is required." }
                        : {})}
                    >
                      {({ id }) => (
                        <Input
                          id={id}
                          value={reason}
                          maxLength={2_000}
                          onChange={(event) => {
                            setReason(event.target.value)
                          }}
                        />
                      )}
                    </FormField>
                    <div className={ACTION_ROW}>
                      <Button
                        tone="secondary"
                        disabled={reasonMissing || action.isPending}
                        onClick={() => {
                          setConfirming("reconcile")
                        }}
                      >
                        Ask PhonePe for the state
                      </Button>
                      <Button
                        tone="danger"
                        disabled={reasonMissing || action.isPending}
                        onClick={() => {
                          setConfirming("cancel")
                        }}
                      >
                        Cancel the mandate
                      </Button>
                    </div>
                  </>
                ) : (
                  <Alert tone="info" title="You can read this but not act on it">
                    Reconciling or cancelling a mandate needs the finance.operate permission.
                  </Alert>
                )}
              </Card>
            </Section>

            <Section title="Setup attempts">
              {data.setupAttempts.length === 0 ? (
                <Card>
                  <p className={PROSE_SM}>No setup has been attempted.</p>
                </Card>
              ) : (
                <AdminTable
                  caption="Setup attempts"
                  rows={data.setupAttempts}
                  rowKey={(row) => row.setupAttemptId}
                  columns={[
                    {
                      key: "state",
                      header: "State",
                      render: (row) => (
                        <StatusBadge
                          status={mandateSetupState(row.state)}
                        />
                      ),
                    },
                    {
                      key: "provider",
                      header: "Provider order",
                      render: (row) => (
                        <span className={ADMIN_CODE}>{row.providerOrderId ?? "—"}</span>
                      ),
                    },
                    {
                      key: "failure",
                      header: "Reported reason",
                      render: (row) => row.failureCode ?? "—",
                    },
                    {
                      key: "expires",
                      header: "Expires",
                      render: (row) => formatDateTime(row.expiresAt),
                    },
                    {
                      key: "updated",
                      header: "Updated",
                      render: (row) => formatDateTime(row.updatedAt),
                    },
                  ]}
                />
              )}
            </Section>

            <Section title="Collection attempts">
              {data.collectionAttempts.length === 0 ? (
                <Card>
                  <p className={PROSE_SM}>No installment has been collected yet.</p>
                </Card>
              ) : (
                <AdminTable
                  caption="Collection attempts"
                  rows={data.collectionAttempts}
                  rowKey={(row) => row.collectionId}
                  columns={[
                    {
                      key: "period",
                      header: "Due period",
                      render: (row) => formatDate(row.duePeriod),
                    },
                    {
                      key: "amount",
                      header: "Amount",
                      numeric: true,
                      render: (row) => (
                        <span className={ADMIN_FIGURE}>{rupees.format(row.amountPaise / 100)}</span>
                      ),
                    },
                    { key: "notify", header: "Notification", render: (row) => row.notifyState },
                    {
                      key: "scheduled",
                      header: "Scheduled debit",
                      render: (row) => formatDateTime(row.scheduledDebitAt),
                    },
                    {
                      key: "failure",
                      header: "Reported reason",
                      render: (row) => row.failureCode ?? "—",
                    },
                  ]}
                />
              )}
            </Section>

            {data.cancelCommands.length === 0 ? null : (
              <Section title="Cancellation commands">
                <AdminTable
                  caption="Cancellation commands"
                  rows={data.cancelCommands}
                  rowKey={(row) => row.commandId}
                  columns={[
                    { key: "state", header: "State", render: (row) => row.state },
                    {
                      key: "failure",
                      header: "Reported reason",
                      render: (row) => row.failureCode ?? "—",
                    },
                    {
                      key: "created",
                      header: "Queued",
                      render: (row) => formatDateTime(row.createdAt),
                    },
                    {
                      key: "updated",
                      header: "Updated",
                      render: (row) => formatDateTime(row.updatedAt),
                    },
                  ]}
                />
              </Section>
            )}

            <ConfirmDialog
              open={confirming === "reconcile"}
              title="Ask PhonePe for this mandate's state?"
              description="We read the provider's own answer and record it. Nothing is assumed and no money moves."
              confirmLabel="Ask PhonePe"
              pending={action.isPending}
              onConfirm={() => {
                run("reconcile")
              }}
              onCancel={() => {
                setConfirming(null)
              }}
            />

            <ConfirmDialog
              open={confirming === "cancel"}
              title="Cancel this mandate?"
              description="This queues a revocation with PhonePe. Until PhonePe confirms it, the mandate shows as cancellation pending — it is not cancelled because we asked."
              confirmLabel="Queue the cancellation"
              confirmTone="danger"
              pending={action.isPending}
              onConfirm={() => {
                run("cancel")
              }}
              onCancel={() => {
                setConfirming(null)
              }}
            />
          </>
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default MandateDetailScreen
