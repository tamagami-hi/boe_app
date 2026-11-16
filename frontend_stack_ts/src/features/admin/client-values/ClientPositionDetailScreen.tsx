import { useState } from "react"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { useClientLedgerPage } from "~/features/admin/client-returns/returnQueries"
import {
  useAdminInvestorPositions,
  useReverseClientLedgerEntry,
} from "~/features/admin/shared/adminQueries"
import { useAdminFundCatalogue } from "~/features/admin/shared/queries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Badge } from "~/ui/primitives/Badge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"

import { ADMIN_CODE } from "~/ui/recipes/admin"

import { EarlierInvestmentForm } from "./EarlierInvestmentForm"
import { EARLY_EXIT_LABEL, EarlyExitLabelFailure } from "./EarlyExitLabelFailure"
import { earlyExitEntryIds, useClientSipEarlyExits } from "./earlyExitQueries"
import { InvestorPicker } from "./InvestorPicker"
import { useLinkedInvestor } from "./linkedInvestor"
import { useLinkedRecord } from "./linkedRecord"
import { ListSkeleton } from "./ListSkeleton"
import { MaturityPanel } from "./MaturityPanel"
import { SipEarlyExitList } from "./SipEarlyExitList"

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

type ReversalFailure = Readonly<{ tone: "warning" | "error"; title: string; message: string }>

const ClientPositionDetailScreen = (): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canWrite = hasAnyPermission(["client_position.write"])
  const funds = useAdminFundCatalogue()
  const reverse = useReverseClientLedgerEntry()
  const { linked, relink } = useLinkedRecord()

  const [userId, setUserId] = useState(linked.userId)
  const [pickedLabel, setPickedLabel] = useState("")
  const [failure, setFailure] = useState<ReversalFailure | null>(null)
  const [pendingReversal, setPendingReversal] = useState<string | null>(null)

  const positions = useAdminInvestorPositions(userId)
  const ledger = useClientLedgerPage(userId)
  const earlyExits = useClientSipEarlyExits(userId)
  const earlyExitEntries = earlyExitEntryIds(earlyExits)
  const investor = useLinkedInvestor(userId, pickedLabel)

  const fundCatalogue = funds.data?.items ?? []
  const fundName = (id: string): string => {
    const fund = fundCatalogue.find((entry) => entry.id === id)
    return fund?.name ?? fund?.slug ?? id
  }

  const resetInvestor = (next: string, label: string): void => {
    setUserId(next)
    setPickedLabel(label)
    relink({ userId: next, fundId: "" })
    setFailure(null)
    reverse.reset()
  }

  const describeReversalFailure = (error: unknown): ReversalFailure => {
    if (isUnknownWriteOutcome(error)) {
      return {
        tone: "warning",
        title: "Not confirmed",
        message:
          "The reply did not arrive, so it is not known whether the reversal was appended. Check the ledger entries before trying again. An entry can only be reversed once.",
      }
    }
    return {
      tone: "error",
      title: "Not reversed",
      message:
        isApiError(error) && error.code !== "RESOURCE_NOT_FOUND"
          ? error.message
          : "That entry could not be found for this investor. Refresh the ledger and try again.",
    }
  }

  const confirmReversal = (): void => {
    const entryId = pendingReversal
    setPendingReversal(null)
    if (entryId === null) return
    setFailure(null)
    reverse.mutate(
      { userId, entryId, reasonCode: REVERSAL_REASON },
      {
        onError: (error) => {
          setFailure(describeReversalFailure(error))
        },
      },
    )
  }

  return (
    <Page width="wide">
      <PageHeader
        title="One investor's record"
        description="Review an investor’s positions, record investments, settle matured positions and correct entries."
      />

      {canWrite ? null : (
        <Alert tone="info" title="Read only">
          Recording an investment or reversing an entry needs the client_position.write permission.
        </Alert>
      )}

      {failure === null ? null : (
        <Alert tone={failure.tone} title={failure.title}>
          {failure.message}
        </Alert>
      )}

      {reverse.data === undefined ? null : (
        <Alert tone="success" title="Entry reversed">
          The reversal is appended with the original&apos;s effective date, so the statement period
          it landed in is corrected too.
        </Alert>
      )}

      <Card elevated>
        <InvestorPicker
          userId={userId}
          hint="Search by name, email or phone."
          onChange={(choice) => {
            resetInvestor(choice.userId, choice.label)
          }}
        />
        {investor.notice}
      </Card>

      {userId === "" ? null : (
        <>
          <Section
            title="Positions"
            description="Folded from the ledger on every read. There is no stored balance."
          >
            <AsyncBoundary
              query={positions}
              skeleton={<ListSkeleton />}
              isEmpty={(data) => data.items.length === 0}
              empty={
                <EmptyState
                  title="No position yet"
                  description="This investor has no recorded investment in any fund."
                />
              }
            >
              {(data) => (
                <AdminTable
                  caption="Per-fund positions"
                  rows={data.items}
                  rowKey={(row) => row.fundId}
                  columns={[
                    { key: "fund", header: "Fund", render: (row) => fundName(row.fundId) },
                    {
                      key: "principal",
                      header: "Invested",
                      numeric: true,
                      render: (row) => <MoneyValue amount={toPaise(row.principalPaise)} size="sm" showDecimals />,
                    },
                    {
                      key: "value",
                      header: "Current value",
                      numeric: true,
                      render: (row) => (
                        <MoneyValue amount={toPaise(row.currentValuePaise)} size="sm" showDecimals />
                      ),
                    },
                    {
                      key: "growth",
                      header: "Growth",
                      numeric: true,
                      render: (row) => (
                        <MoneyValue
                          amount={toPaise(row.totalGrowthPaise)}
                          size="sm"
                          tone="signed"
                          showSign
                          showDecimals
                        />
                      ),
                    },
                  ]}
                />
              )}
            </AsyncBoundary>
          </Section>

          {positions.data === undefined ? null : (
            <MaturityPanel
              key={userId}
              userId={userId}
              canWrite={canWrite}
              positions={positions.data.items}
              fundName={fundName}
            />
          )}

          <SipEarlyExitList userId={userId} canWrite={canWrite} />

          <Section
            title="Record an investment"
            description="An earlier investment, a monthly investment or a correction, written as an accepted order, a succeeded payment, an allocation and an ordinary contribution, all dated by the real date so the statement for that period is right. The investor is notified and sees a receipt."
          >
            <EarlierInvestmentForm
              key={userId}
              userId={userId}
              investorLabel={investor.label === "" ? "The selected investor" : investor.label}
            />
          </Section>

          <Section
            title="Ledger entries"
            description="Append-only. Reversing an entry writes a new row that negates it; an entry can be reversed once."
          >
            <EarlyExitLabelFailure query={earlyExits} />
            <AsyncBoundary
              query={ledger}
              skeleton={<ListSkeleton />}
              isEmpty={(data) => data.items.length === 0}
              empty={
                <EmptyState
                  title="No ledger entry yet"
                  description="Nothing has been recorded for this investor."
                />
              }
            >
              {(data) => (
                <AdminTable
                  caption="Ledger entries, newest effective date first"
                  rows={data.items}
                  rowKey={(row) => row.entryId}
                  columns={[
                    { key: "date", header: "Effective", render: (row) => formatDate(row.effectiveDate) },
                    { key: "fund", header: "Fund", render: (row) => fundName(row.fundId) },
                    {
                      key: "kind",
                      header: "Entry",
                      render: (row) => (
                        <Badge tone={row.entryType === "reversal" ? "neutral" : "info"}>
                          {`${earlyExitEntries.has(row.entryId) ? EARLY_EXIT_LABEL : (ENTRY_LABEL[row.entryType] ?? row.entryType)}${
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
                        <MoneyValue
                          amount={toPaise(row.principalDeltaPaise)}
                          size="sm"
                          tone="signed"
                          showSign
                          showDecimals
                        />
                      ),
                    },
                    {
                      key: "value",
                      header: "Value change",
                      numeric: true,
                      render: (row) => (
                        <MoneyValue
                          amount={toPaise(row.valueDeltaPaise)}
                          size="sm"
                          tone="signed"
                          showSign
                          showDecimals
                        />
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
                            disabled={!canWrite}
                            onClick={() => {
                              setPendingReversal(row.entryId)
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
          </Section>
        </>
      )}

      <ConfirmDialog
        open={pendingReversal !== null}
        title="Reverse this entry?"
        description="A reversal is appended that exactly negates this entry, dated the same day so the statement period is corrected too. It cannot be undone, and this entry cannot be reversed twice. The investor is notified."
        confirmLabel="Append the reversal"
        cancelLabel="Leave it alone"
        confirmTone="danger"
        onConfirm={confirmReversal}
        onCancel={() => {
          setPendingReversal(null)
        }}
      />
    </Page>
  )
}

export default ClientPositionDetailScreen
