import { useEffect, useState } from "react"

import type { DataOf } from "~/api/http"
import type { listAdminClientLedgerPage } from "~/api/generated/operations"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { formatDate, formatDateTime } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { useClientLedgerPage } from "~/features/admin/client-returns/returnQueries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { useFundNames } from "~/features/admin/shared/fundNames"
import { HeldWriteNotice, UnsavedHoldNotice, isUnsavedHold } from "~/features/admin/shared/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { useUnloadGuard } from "~/features/admin/shared/useUnloadGuard"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Badge } from "~/ui/primitives/Badge"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"

import { EARLY_EXIT_LABEL, EarlyExitLabelFailure } from "./EarlyExitLabelFailure"
import { earlyExitEntryIds, useClientSipEarlyExits } from "./earlyExitQueries"
import { parseLedgerReversal } from "./heldBodies"
import { ledgerReasonLabel } from "./ledgerReasons"
import { useReverseClientLedgerEntry } from "./ledgerReversalQueries"
import { ListSkeleton } from "./ListSkeleton"
import { RecordingCategoryFailure, assignedLabels } from "./RecordingCategoryLabels"
import { useClientRecordings } from "./recordingCategoryQueries"

type LedgerRow = DataOf<typeof listAdminClientLedgerPage>["items"][number]

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

const UNSENT = "The reversal could not be sent. Reload the page and try again."

export const ledgerReversalSlot = (userId: string): string => `ledger-reversal:${userId}`

const rejectionOf = (code: string | null, message: string): string =>
  code === "RESOURCE_NOT_FOUND" ? "That entry could not be found for this investor. Reload the ledger and try again." : message

export type LedgerEntriesProps = Readonly<{
  userId: string
  investorLabel: string
  canWrite: boolean
  showRecordedAt?: boolean
  showFundNotice?: boolean
  onUnsavedHold?: (unsaved: boolean) => void
}>

export const LedgerEntries = ({
  userId,
  investorLabel,
  canWrite,
  showRecordedAt = false,
  showFundNotice = true,
  onUnsavedHold,
}: LedgerEntriesProps): React.ReactElement => {
  const ledger = useClientLedgerPage(userId)
  const earlyExits = useClientSipEarlyExits(userId)
  const earlyExitEntries = earlyExitEntryIds(earlyExits)
  const recordings = useClientRecordings(userId)
  const categoryLabels = assignedLabels(recordings)
  const funds = useFundNames()
  const write = useHeldWrite(useReverseClientLedgerEntry(), UNSENT, {
    slot: ledgerReversalSlot(userId),
    parseBody: parseLedgerReversal,
  })
  const [asking, setAsking] = useState<LedgerRow | null>(null)
  const unsaved = isUnsavedHold(write)
  useUnloadGuard(unsaved)
  const heldEntryId = write.held?.entryId ?? null

  useEffect(() => {
    onUnsavedHold?.(unsaved)
    return () => {
      onUnsavedHold?.(false)
    }
  }, [unsaved, onUnsavedHold])

  const entryLabel = (row: LedgerRow): string =>
    `${earlyExitEntries.has(row.entryId) ? EARLY_EXIT_LABEL : (ENTRY_LABEL[row.entryType] ?? row.entryType)}${
      row.orderType === null ? "" : ` · ${ORDER_LABEL[row.orderType] ?? row.orderType}`
    }`

  const confirm = (): void => {
    const row = asking
    setAsking(null)
    if (row !== null) write.submit({ userId, entryId: row.entryId, reasonCode: REVERSAL_REASON })
  }

  const actionFor = (row: LedgerRow): React.ReactElement => {
    if (row.reversedByEntryId !== null) return <Badge tone="neutral">Reversed</Badge>
    if (row.entryId === heldEntryId) return <Badge tone="warning">Not confirmed</Badge>
    if (!row.reversible) return <span />
    return (
      <Button
        tone="danger"
        size="sm"
        disabled={!canWrite || write.held !== null || write.pending || write.unreadable}
        onClick={() => {
          setAsking(row)
        }}
      >
        Reverse
      </Button>
    )
  }

  return (
    <>
      {showFundNotice ? funds.notice : null}
      <EarlyExitLabelFailure query={earlyExits} />
      <RecordingCategoryFailure query={recordings} />
      {write.outcome.kind === "rejected" ? (
        <Alert tone="error" title="Not reversed">
          {rejectionOf(write.outcome.code, write.outcome.message)}
        </Alert>
      ) : (
        <HeldWriteNotice
          write={write}
          subject="the reversal was appended"
          reloadLabel="Reload the ledger"
          onReload={ledger.refetch}
        />
      )}
      <UnsavedHoldNotice write={write} />
      {write.outcome.kind === "done" ? (
        <Alert tone="success" title="Entry reversed">
          The reversal carries the original&apos;s effective date, so that statement period is corrected too.
        </Alert>
      ) : null}
      <AsyncBoundary
        query={ledger}
        skeleton={<ListSkeleton />}
        isEmpty={(data) => data.items.length === 0}
        empty={<EmptyState title="No ledger entry yet" description="Nothing has been recorded for this investor." />}
      >
        {(data) => (
          <AdminTable
            caption="Ledger entries, newest effective date first"
            rows={data.items}
            rowKey={(row) => row.entryId}
            columns={[
              { key: "date", header: "Effective", render: (row) => formatDate(row.effectiveDate) },
              ...(showRecordedAt
                ? [{ key: "recorded", header: "Recorded", render: (row: LedgerRow) => formatDateTime(row.createdAt) }]
                : []),
              { key: "fund", header: "Fund", render: (row) => funds.nameOf(row.fundId) },
              {
                key: "kind",
                header: "Entry",
                render: (row) => (
                  <Badge tone={row.entryType === "reversal" ? "neutral" : "info"}>{entryLabel(row)}</Badge>
                ),
              },
              {
                key: "principal",
                header: "Invested change",
                numeric: true,
                render: (row) => (
                  <MoneyValue amount={toPaise(row.principalDeltaPaise)} size="sm" tone="signed" showSign showDecimals />
                ),
              },
              {
                key: "value",
                header: "Value change",
                numeric: true,
                render: (row) => (
                  <MoneyValue amount={toPaise(row.valueDeltaPaise)} size="sm" tone="signed" showSign showDecimals />
                ),
              },
              {
                key: "reason",
                header: "Reason",
                render: (row) => categoryLabels.get(row.entryId) ?? ledgerReasonLabel(row.reasonCode),
              },
              { key: "action", header: "Correction", render: actionFor },
            ]}
          />
        )}
      </AsyncBoundary>
      <LoadMore list={ledger} noun="entries" />
      <ConfirmDialog
        open={asking !== null}
        title="Reverse this entry?"
        description="A reversal is appended that exactly negates this entry, dated the same day so the statement period is corrected too. It cannot be undone, and this entry cannot be reversed twice. The investor is notified."
        confirmLabel="Append the reversal"
        cancelLabel="Leave it alone"
        confirmTone="danger"
        onConfirm={confirm}
        onCancel={() => {
          setAsking(null)
        }}
      >
        {asking === null ? null : (
          <DataList>
            <DetailRow label="Investor">{investorLabel}</DetailRow>
            <DetailRow label="Fund">{funds.nameOf(asking.fundId)}</DetailRow>
            <DetailRow label="Entry">{entryLabel(asking)}</DetailRow>
            <DetailRow label="Effective">{formatDate(asking.effectiveDate)}</DetailRow>
            <DetailRow label="Invested change" emphasis="lead">
              <MoneyValue amount={toPaise(asking.principalDeltaPaise)} size="sm" tone="signed" showSign showDecimals />
            </DetailRow>
            <DetailRow label="Value change">
              <MoneyValue amount={toPaise(asking.valueDeltaPaise)} size="sm" tone="signed" showSign showDecimals />
            </DetailRow>
          </DataList>
        )}
      </ConfirmDialog>
    </>
  )
}
