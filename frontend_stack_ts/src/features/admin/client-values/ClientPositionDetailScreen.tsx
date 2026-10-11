import { useMemo, useState } from "react"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { toPaise } from "~/domain/money"
import {
  useAdminClientLedgerEntries,
  useAdminInvestorPositions,
  useAdminUsers,
  useReverseClientLedgerEntry,
} from "~/features/admin/shared/adminQueries"
import { useAdminFundCatalogue } from "~/features/admin/shared/queries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Badge } from "~/ui/primitives/Badge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Combobox } from "~/ui/primitives/Combobox"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField } from "~/ui/primitives/FormField"

import { ADMIN_CODE } from "~/ui/recipes/admin"

import { EarlierInvestmentForm } from "./EarlierInvestmentForm"
import { MaturityPanel } from "./MaturityPanel"

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
  recorded_offline: "Recorded earlier",
}

const REVERSAL_REASON = "admin_correction_reversal"

type ReversalFailure = Readonly<{ tone: "warning" | "error"; title: string; message: string }>

const ClientPositionDetailScreen = (): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canWrite = hasAnyPermission(["client_position.write"])
  const funds = useAdminFundCatalogue()
  const reverse = useReverseClientLedgerEntry()

  const [userId, setUserId] = useState("")
  const [investorQuery, setInvestorQuery] = useState("")
  const [failure, setFailure] = useState<ReversalFailure | null>(null)
  const [pendingReversal, setPendingReversal] = useState<string | null>(null)

  const investors = useAdminUsers(investorQuery.trim() === "" ? {} : { q: investorQuery.trim() })
  const positions = useAdminInvestorPositions(userId)
  const ledger = useAdminClientLedgerEntries(userId, "")

  const fundCatalogue = funds.data?.items ?? []
  const fundName = (id: string): string => {
    const fund = fundCatalogue.find((entry) => entry.id === id)
    return fund?.name ?? fund?.slug ?? id
  }

  const investorOptions = useMemo(
    () =>
      (investors.data?.items ?? []).map((user) => ({
        value: user.id,
        label: user.fullName === "" ? user.email : user.fullName,
        hint: [user.email, user.phone].filter((part) => part !== "").join(" · "),
      })),
    [investors.data],
  )

  const positionItems = positions.data?.items ?? []
  const ledgerItems = ledger.data?.items ?? []
  const investorLabel =
    investorOptions.find((option) => option.value === userId)?.label ?? "The selected investor"

  const resetInvestor = (next: string): void => {
    setUserId(next)
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
        description="Review an investor’s positions, record earlier investments, settle matured positions and correct entries."
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
        <FormField
          label="Investor"
          required
          hint="Search by name, email or phone."
        >
          {({ id }) => (
            <Combobox
              id={id}
              options={investorOptions}
              value={userId}
              onChange={resetInvestor}
              query={investorQuery}
              onQueryChange={setInvestorQuery}
              placeholder="Start typing a name"
              loading={investors.isFetching}
              emptyLabel="No investor matches that"
            />
          )}
        </FormField>
      </Card>

      {userId === "" ? null : (
        <>
          <Section
            title="Positions"
            description="Folded from the ledger on every read. There is no stored balance."
          >
            <AdminTable
              caption="Per-fund positions"
              rows={positionItems}
              rowKey={(row) => row.fundId}
              columns={[
                { key: "fund", header: "Fund", render: (row) => fundName(row.fundId) },
                {
                  key: "principal",
                  header: "Invested",
                  numeric: true,
                  render: (row) => <MoneyValue amount={toPaise(row.principalPaise)} size="sm" />,
                },
                {
                  key: "value",
                  header: "Current value",
                  numeric: true,
                  render: (row) => <MoneyValue amount={toPaise(row.currentValuePaise)} size="sm" />,
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
                    />
                  ),
                },
              ]}
            />
          </Section>

          <MaturityPanel key={userId} userId={userId} canWrite={canWrite} positions={positionItems} fundName={fundName} />

          <Section
            title="Record an investment made before the app"
            description="Written as what it was: an accepted order, a succeeded payment, an allocation and an ordinary contribution, all dated by the real investment date so the statement for that period is right. The investor is notified."
          >
            <EarlierInvestmentForm key={userId} userId={userId} investorLabel={investorLabel} />
          </Section>

          <Section
            title="Ledger entries"
            description="Append-only. Reversing an entry writes a new row that negates it; an entry can be reversed once."
          >
            <AdminTable
              caption="Ledger entries"
              rows={ledgerItems}
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
                    <MoneyValue
                      amount={toPaise(row.principalDeltaPaise)}
                      size="sm"
                      tone="signed"
                      showSign
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
