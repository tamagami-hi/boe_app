import { useState } from "react"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { toPaise } from "~/domain/money"
import { useClientLedgerPage } from "~/features/admin/client-returns/returnQueries"
import { useReverseClientLedgerEntry } from "~/features/admin/shared/adminQueries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { useAdminFundCatalogue } from "~/features/admin/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Badge } from "~/ui/primitives/Badge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { ADMIN_CODE } from "~/ui/recipes/admin"

const ENTRY_LABEL: Readonly<Record<string, string>> = {
  contribution: "Contribution",
  growth_adjustment: "Growth",
  reversal: "Reversal",
  withdrawal: "Withdrawal",
  maturity_reinvestment: "Maturity reinvestment",
}

const ORDER_LABEL: Readonly<Record<string, string>> = {
  lump_sum: "One-off",
  sip_installment: "SIP",
  recorded_offline: "Recorded",
}

const REVERSAL_REASON = "admin_correction_reversal"

type Failure = Readonly<{ tone: "warning" | "error"; title: string; message: string }>

const describeFailure = (error: unknown): Failure => {
  if (isUnknownWriteOutcome(error)) {
    return {
      tone: "warning",
      title: "Not confirmed",
      message:
        "The reply did not arrive, so it is not known whether the reversal was appended. Check the ledger before trying again. An entry can only be reversed once.",
    }
  }
  return {
    tone: "error",
    title: "Not reversed",
    message:
      isApiError(error) && error.code !== "RESOURCE_NOT_FOUND"
        ? error.message
        : "That entry could not be found for this client. Refresh the ledger and try again.",
  }
}

type Props = Readonly<{ userId: string }>

export const ClientLedgerTab = ({ userId }: Props): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canWrite = hasAnyPermission(["client_position.write"])
  const ledger = useClientLedgerPage(userId)
  const funds = useAdminFundCatalogue()
  const reverse = useReverseClientLedgerEntry()
  const [pending, setPending] = useState<string | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)

  const fundName = (id: string): string => {
    const fund = (funds.data?.items ?? []).find((entry) => entry.id === id)
    return fund?.name ?? fund?.slug ?? id
  }

  const confirm = (): void => {
    const entryId = pending
    setPending(null)
    if (entryId === null) return
    setFailure(null)
    reverse.mutate(
      { userId, entryId, reasonCode: REVERSAL_REASON },
      {
        onError: (error) => {
          setFailure(describeFailure(error))
        },
      },
    )
  }

  return (
    <>
      {failure === null ? null : (
        <Alert tone={failure.tone} title={failure.title}>
          {failure.message}
        </Alert>
      )}
      {reverse.data === undefined ? null : (
        <Alert tone="success" title="Entry reversed">
          The reversal carries the original&apos;s effective date, so that statement period is corrected too.
        </Alert>
      )}
      <AsyncBoundary
        query={ledger}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="45%" />
            <Skeleton height="1rem" width="70%" />
          </Card>
        }
        isEmpty={(data) => data.items.length === 0}
        empty={<EmptyState title="No ledger entry yet" description="Nothing has been recorded for this client." />}
      >
        {(data) => (
          <AdminTable
            caption="Ledger entries, newest effective date first"
            rows={data.items}
            rowKey={(row) => row.entryId}
            columns={[
              { key: "date", header: "Effective", render: (row) => row.effectiveDate },
              { key: "fund", header: "Fund", render: (row) => fundName(row.fundId) },
              {
                key: "kind",
                header: "Entry",
                render: (row) => (
                  <Badge tone={row.entryType === "reversal" ? "neutral" : "info"}>
                    {`${ENTRY_LABEL[row.entryType] ?? row.entryType}${
                      row.orderType === null ? "" : ` · ${ORDER_LABEL[row.orderType] ?? row.orderType}`
                    }`}
                  </Badge>
                ),
              },
              {
                key: "principal",
                header: "Invested change",
                numeric: true,
                render: (row) => (
                  <MoneyValue amount={toPaise(row.principalDeltaPaise)} size="sm" tone="signed" showSign />
                ),
              },
              {
                key: "value",
                header: "Value change",
                numeric: true,
                render: (row) => (
                  <MoneyValue amount={toPaise(row.valueDeltaPaise)} size="sm" tone="signed" showSign />
                ),
              },
              {
                key: "reason",
                header: "Reason",
                render: (row) => <span className={ADMIN_CODE}>{row.reasonCode}</span>,
              },
              {
                key: "action",
                header: "Correction",
                render: (row) =>
                  row.reversedByEntryId !== null ? (
                    <Badge tone="neutral">Reversed</Badge>
                  ) : row.reversible ? (
                    <Button
                      tone="danger"
                      size="sm"
                      disabled={!canWrite || reverse.isPending}
                      onClick={() => {
                        setPending(row.entryId)
                      }}
                    >
                      Reverse
                    </Button>
                  ) : (
                    <span />
                  ),
              },
            ]}
          />
        )}
      </AsyncBoundary>
      <LoadMore list={ledger} noun="entries" />
      <ConfirmDialog
        open={pending !== null}
        title="Reverse this entry?"
        description="A reversal is appended that exactly negates this entry, dated the same day so the statement period is corrected too. It cannot be undone, and this entry cannot be reversed twice. The client is notified."
        confirmLabel="Append the reversal"
        cancelLabel="Leave it alone"
        confirmTone="danger"
        onConfirm={confirm}
        onCancel={() => {
          setPending(null)
        }}
      />
    </>
  )
}
