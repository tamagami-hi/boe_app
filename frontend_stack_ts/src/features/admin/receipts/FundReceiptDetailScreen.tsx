import { useState } from "react"
import { useParams } from "react-router-dom"

import { hasCode, isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { fundReceiptAcknowledgementState, fundState, paymentState } from "~/domain/status"
import { useAcknowledgeReceipt, useAdminReceipt } from "~/features/admin/shared/adminQueries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { FormField } from "~/ui/primitives/FormField"
import { Textarea } from "~/ui/primitives/Textarea"

import { ADMIN_CODE, ADMIN_LABEL } from "~/ui/recipes/admin"
import { PROSE_SM } from "~/ui/recipes/datalist"

type Failure = Readonly<{ isUnknown: boolean; message: string }>

const acknowledgementFailure = (error: unknown): Failure => {
  if (hasCode(error, "STATE_CONFLICT")) {
    return {
      isUnknown: false,
      message:
        "This receipt changed while you were looking at it. It has been refreshed. Read it again before acknowledging.",
    }
  }
  if (isUnknownWriteOutcome(error)) {
    return {
      isUnknown: true,
      message:
        "The reply did not arrive, so it is not known whether the acknowledgement was recorded or the investor was notified. Reload this receipt to see its current state before trying again.",
    }
  }
  return { isUnknown: false, message: isApiError(error) ? error.message : "We could not record the acknowledgement." }
}

const FundReceiptDetailScreen = (): React.ReactElement => {
  const { orderId = "" } = useParams()
  const query = useAdminReceipt(orderId)
  const acknowledge = useAcknowledgeReceipt(orderId)
  const { hasAnyPermission } = useSession()
  const [note, setNote] = useState("")
  const [failure, setFailure] = useState<Failure | null>(null)
  const [confirmingVersion, setConfirmingVersion] = useState<number | null>(null)

  const canWrite = hasAnyPermission(["funds.receipts.write"])

  const acknowledgeAt = (expectedVersion: number): void => {
    setFailure(null)
    acknowledge.mutate(
      { expectedVersion, ...(note.trim() === "" ? {} : { privateNote: note.trim() }) },
      {
        onError: (error) => {
          setFailure(acknowledgementFailure(error))
          if (hasCode(error, "STATE_CONFLICT")) void query.refetch()
        },
        onSuccess: () => {
          setNote("")
        },
        onSettled: () => {
          setConfirmingVersion(null)
        },
      },
    )
  }

  return (
    <Page width="default">
      <PageHeader
        title="Fund receipt"
        description="Confirm that the money for this order actually reached the fund account. The investor is notified when you do."
      />

      <AsyncBoundary
        query={query}
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
              <Alert
                tone={failure.isUnknown ? "warning" : "error"}
                title={failure.isUnknown ? "Outcome unknown" : "Nothing changed"}
              >
                {failure.message}
              </Alert>
            )}

            <Card elevated>
              <span className={ADMIN_LABEL}>Amount received</span>
              <MoneyValue amount={toPaise(data.amountPaise)} size="xl" />

              <DataList split>
                <DetailRow label="Investor">{data.client.name}</DetailRow>
                <DetailRow label="Email">{data.client.email}</DetailRow>
                <DetailRow label="Fund">{data.selectedFund.name}</DetailRow>
                <DetailRow label="Fund state">
                  <StatusBadge status={fundState(data.selectedFund.state)} />
                </DetailRow>
                <DetailRow label="Payment state">
                  <StatusBadge status={paymentState(data.payment.state)} />
                </DetailRow>
                <DetailRow label="Provider">{data.payment.provider}</DetailRow>
                <DetailRow label="Merchant order">
                  <span className={ADMIN_CODE}>{data.payment.merchantOrderId ?? "—"}</span>
                </DetailRow>
                <DetailRow label="Provider reference">
                  <span className={ADMIN_CODE}>{data.payment.providerReference ?? "—"}</span>
                </DetailRow>
                <DetailRow label="Settled">
                  {data.payment.succeededAt === null
                    ? "—"
                    : formatDateTime(data.payment.succeededAt)}
                </DetailRow>
                <DetailRow label="Receipt">
                  <StatusBadge
                    status={fundReceiptAcknowledgementState(data.acknowledgement.state)}
                  />
                </DetailRow>
                <DetailRow label="Receipt version">
                  {String(data.acknowledgement.version)}
                </DetailRow>
              </DataList>
            </Card>

            {data.acknowledgement.state === "acknowledged" ? (
              <Section title="Already acknowledged">
                <Card>
                  <DataList>
                    <DetailRow label="Acknowledged">
                      {data.acknowledgement.acknowledgedAt === null
                        ? "—"
                        : formatDateTime(data.acknowledgement.acknowledgedAt)}
                    </DetailRow>
                    <DetailRow label="Private note">
                      {data.acknowledgement.privateNote ?? "None"}
                    </DetailRow>
                  </DataList>
                </Card>
              </Section>
            ) : (
              <Section
                title="Acknowledge the funds"
                description="Only do this once you have seen the money in the fund account. The investor is told their funds are ready to invest."
              >
                <Card>
                  {canWrite ? (
                    <>
                      <FormField
                        label="Private note"
                        hint="Kept internal. Never shown to the investor."
                      >
                        {({ id }) => (
                          <Textarea
                            id={id}
                            value={note}
                            maxLength={2_000}
                            onChange={(event) => {
                              setNote(event.target.value)
                            }}
                          />
                        )}
                      </FormField>
                      <p className={PROSE_SM}>
                        This is sent with the receipt version we read above. If someone else
                        acknowledges it first, the request is refused rather than overwriting their
                        decision.
                      </p>
                      <Button
                        loading={acknowledge.isPending}
                        onClick={() => {
                          setConfirmingVersion(data.acknowledgement.version)
                        }}
                        trailing
                      >
                        Acknowledge the funds
                      </Button>
                    </>
                  ) : (
                    <Alert tone="info" title="You can read this but not acknowledge it">
                      Your role cannot acknowledge funds.
                    </Alert>
                  )}
                </Card>
              </Section>
            )}
          </>
        )}
      </AsyncBoundary>

      <ConfirmDialog
        open={confirmingVersion !== null}
        title="Acknowledge these funds?"
        description="Confirm only after you have seen this money in the fund account. The investor is notified as soon as you acknowledge."
        confirmLabel="Acknowledge and notify"
        pending={acknowledge.isPending}
        onConfirm={() => {
          if (confirmingVersion !== null) acknowledgeAt(confirmingVersion)
        }}
        onCancel={() => {
          setConfirmingVersion(null)
        }}
      />
    </Page>
  )
}

export default FundReceiptDetailScreen
