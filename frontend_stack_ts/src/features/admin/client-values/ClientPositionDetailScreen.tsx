import { useState } from "react"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { toPaise } from "~/domain/money"
import { useAdminInvestorPositions } from "~/features/admin/shared/adminQueries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { useFundNames } from "~/features/admin/shared/fundNames"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"

import { EarlierInvestmentForm, type RecordingHold } from "./EarlierInvestmentForm"
import { InvestorPicker, type InvestorChoice } from "./InvestorPicker"
import { LedgerEntries } from "./LedgerEntries"
import { useLinkedInvestor } from "./linkedInvestor"
import { useFollowedLink, useLinkedRecord } from "./linkedRecord"
import { ListSkeleton } from "./ListSkeleton"
import { MaturityPanel } from "./MaturityPanel"
import { SipEarlyExitList } from "./SipEarlyExitList"

const ClientPositionDetailScreen = (): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canWrite = hasAnyPermission(["client_position.write"])
  const funds = useFundNames()
  const link = useLinkedRecord()

  const [userId, setUserId] = useState(link.linked.userId)
  const [picked, setPicked] = useState<InvestorChoice>({ userId: "", label: "" })
  const [isMaturityUnsaved, setMaturityUnsaved] = useState(false)
  const [isLedgerUnsaved, setLedgerUnsaved] = useState(false)
  const [recordHold, setRecordHold] = useState<RecordingHold>("none")

  const pickedLabel = picked.userId === userId ? picked.label : ""
  const positions = useAdminInvestorPositions(userId)
  const investor = useLinkedInvestor(userId, pickedLabel)
  const isChosen = userId !== "" && !investor.missing
  const isHolding = isMaturityUnsaved || isLedgerUnsaved || recordHold === "unsaved"
  const investorLabel = investor.label === "" ? "The selected investor" : investor.label

  useFollowedLink(link, userId, isHolding, setUserId)

  return (
    <Page width="wide">
      <PageHeader
        title="One investor's record"
        description="Review an investor’s positions, record investments, settle matured positions and correct entries."
      />

      {canWrite ? null : (
        <Alert tone="info" title="Read only">
          Your role cannot record investments or reverse entries.
        </Alert>
      )}

      <Card elevated>
        <InvestorPicker
          userId={userId}
          hint="Search by name, email or phone."
          disabled={isHolding}
          onChange={(choice) => {
            setPicked(choice)
            link.relink({ userId: choice.userId, fundId: "" })
          }}
        />
        {investor.notice}
      </Card>

      {isChosen ? funds.notice : null}

      {isChosen ? (
        <>
          <Section title="Positions" description="Each position is the total of this investor's entries in that fund. No separate balance is stored.">
            <AsyncBoundary
              query={positions}
              skeleton={<ListSkeleton />}
              isEmpty={(data) => data.items.length === 0}
              empty={<EmptyState title="No position yet" description="This investor has no recorded investment in any fund." />}
            >
              {(data) => (
                <AdminTable
                  caption="Per-fund positions"
                  rows={data.items}
                  rowKey={(row) => row.fundId}
                  columns={[
                    { key: "fund", header: "Fund", render: (row) => funds.nameOf(row.fundId) },
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
                      render: (row) => <MoneyValue amount={toPaise(row.currentValuePaise)} size="sm" showDecimals />,
                    },
                    {
                      key: "growth",
                      header: "Growth",
                      numeric: true,
                      render: (row) => (
                        <MoneyValue amount={toPaise(row.totalGrowthPaise)} size="sm" tone="signed" showSign showDecimals />
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
              investorLabel={investorLabel}
              canWrite={canWrite}
              positions={positions.data.items}
              onUnsavedHold={setMaturityUnsaved}
            />
          )}

          <SipEarlyExitList userId={userId} investorLabel={investorLabel} canWrite={canWrite} />

          <Section
            title="Record an investment"
            description="An earlier investment, a monthly investment or a correction, written as an accepted order, a succeeded payment, an allocation and an ordinary contribution, all dated by the real date so the statement for that period is right. The investor is notified and sees a receipt."
          >
            <EarlierInvestmentForm
              key={userId}
              userId={userId}
              investorLabel={investorLabel}
              onHoldChange={setRecordHold}
            />
          </Section>

          <Section
            title="Ledger entries"
            description="Entries are never edited or deleted. Reversing an entry adds a new entry that cancels it; an entry can be reversed once."
          >
            <LedgerEntries
              key={userId}
              userId={userId}
              investorLabel={investorLabel}
              canWrite={canWrite}
              showFundNotice={false}
              onUnsavedHold={setLedgerUnsaved}
            />
          </Section>
        </>
      ) : null}
    </Page>
  )
}

export default ClientPositionDetailScreen
