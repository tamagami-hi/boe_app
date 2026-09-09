import { useMemo, useState } from "react"

import { isApiError } from "~/api/errors"
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
  useRecordClientContribution,
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
import { FormField, Input } from "~/ui/primitives/FormField"
import { Select } from "~/ui/primitives/Select"

import { ADMIN_CODE, ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { STACK_LG } from "~/ui/recipes/layout"

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

const REASON_OPTIONS = [
  { value: "recorded_offline_investment", label: "Investment made before the app" },
  { value: "recorded_offline_correction", label: "Correction to an earlier record" },
] as const

const REVERSAL_REASON = "admin_correction_reversal"

const today = (): string => new Date().toISOString().slice(0, 10)

const ClientPositionDetailScreen = (): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canWrite = hasAnyPermission(["client_position.write"])
  const funds = useAdminFundCatalogue()
  const record = useRecordClientContribution()
  const reverse = useReverseClientLedgerEntry()

  const [userId, setUserId] = useState("")
  const [investorQuery, setInvestorQuery] = useState("")
  const [fundId, setFundId] = useState("")
  const [amountPaise, setAmountPaise] = useState("")
  const [effectiveDate, setEffectiveDate] = useState("")
  const [reasonCode, setReasonCode] = useState<string>(REASON_OPTIONS[0].value)
  const [note, setNote] = useState("")
  const [failure, setFailure] = useState<string | null>(null)
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

  const fundOptions = [
    { value: "", label: userId === "" ? "Choose an investor first" : "Choose a fund" },
    ...fundCatalogue.map((fund) => ({ value: fund.id, label: fund.name ?? fund.slug })),
  ]

  const invalidAmount = !/^[1-9][0-9]*$/u.test(amountPaise)
  const futureDated = effectiveDate !== "" && effectiveDate > today()
  const incomplete =
    !canWrite ||
    userId === "" ||
    fundId === "" ||
    effectiveDate === "" ||
    futureDated ||
    invalidAmount

  const resetInvestor = (next: string): void => {
    setUserId(next)
    setFundId("")
    setFailure(null)
    record.reset()
    reverse.reset()
  }

  const describe = (error: unknown, fallback: string): string =>
    isApiError(error)
      ? error.code === "RESOURCE_NOT_FOUND"
        ? "That investor or fund could not be resolved. Check the selection and try again."
        : error.message
      : fallback

  const submitContribution = (): void => {
    setFailure(null)
    record.mutate(
      {
        userId,
        fundId,
        amountPaise,
        effectiveDate,
        reasonCode,
        ...(note.trim() === "" ? {} : { note: note.trim() }),
      },
      {
        onError: (error) => {
          setFailure(describe(error, "We could not record that investment. Nothing was written."))
        },
      },
    )
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
          setFailure(describe(error, "We could not reverse that entry. Nothing was written."))
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
        <Alert tone="error" title="Nothing was written">
          {failure}
        </Alert>
      )}

      {record.data === undefined ? null : (
        <Alert tone="success" title="Earlier investment recorded">
          {`The investor has been notified. Their amount invested in this fund is now ${record.data.principalPaise} paise and their current value ${record.data.currentValuePaise} paise.`}
          {record.data.fundVersionEffectiveOnDate
            ? ""
            : " No fund version existed on that date, so the current published version was recorded instead."}
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
            <Card elevated>
              <div className={STACK_LG}>
                <div className={ADMIN_FORM_GRID}>
                  <FormField label="Fund" required>
                    {({ id }) => (
                      <Select
                        id={id}
                        options={fundOptions}
                        value={fundId}
                        onChange={(event) => {
                          setFundId(event.target.value)
                        }}
                      />
                    )}
                  </FormField>

                  <FormField
                    label="Amount in paise"
                    required
                    hint="Positive integer paise. 50000000 is ₹5,00,000."
                    {...(invalidAmount && amountPaise !== ""
                      ? { error: "Enter a positive integer number of paise." }
                      : {})}
                  >
                    {({ id }) => (
                      <Input
                        id={id}
                        value={amountPaise}
                        onChange={(event) => {
                          setAmountPaise(event.target.value.trim())
                        }}
                      />
                    )}
                  </FormField>
                </div>

                <div className={ADMIN_FORM_GRID}>
                  <FormField
                    label="Date of the investment"
                    required
                    hint="The real historical date, not today. It decides which statement period the entry lands in."
                    {...(futureDated ? { error: "A past investment cannot be in the future." } : {})}
                  >
                    {({ id }) => (
                      <Input
                        id={id}
                        type="date"
                        max={today()}
                        value={effectiveDate}
                        onChange={(event) => {
                          setEffectiveDate(event.target.value)
                        }}
                      />
                    )}
                  </FormField>

                  <FormField label="Reason code" required>
                    {({ id }) => (
                      <Select
                        id={id}
                        options={REASON_OPTIONS.map((option) => ({ ...option }))}
                        value={reasonCode}
                        onChange={(event) => {
                          setReasonCode(event.target.value)
                        }}
                      />
                    )}
                  </FormField>
                </div>

                <FormField
                  label="Note"
                  hint="Internal. Recorded on the ledger entry, never shown to the investor."
                >
                  {({ id }) => (
                    <Input
                      id={id}
                      value={note}
                      maxLength={2_000}
                      onChange={(event) => {
                        setNote(event.target.value)
                      }}
                    />
                  )}
                </FormField>

                <Button
                  disabled={incomplete}
                  loading={record.isPending}
                  onClick={submitContribution}
                  trailing
                >
                  Record this investment
                </Button>
              </div>
            </Card>
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
