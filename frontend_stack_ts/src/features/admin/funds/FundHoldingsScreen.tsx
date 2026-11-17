import { useState, type SyntheticEvent } from "react"
import { useParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { isUnknownRecord } from "~/features/admin/shared/unknownRecord"
import { useHeldDone } from "~/features/admin/shared/useHeldDone"
import { useAdminFundStocks } from "~/features/admin/shared/adminQueries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { HeldWriteNotice } from "~/features/admin/shared/HeldWriteNotice"
import { PersistedHoldNotices, isHeldOrUnreadable } from "~/features/admin/shared/PersistedHoldNotices"
import { useAdminFund } from "~/features/admin/shared/queries"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { FundStockAllocation } from "~/features/funds/FundStockAllocation"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { Badge } from "~/ui/primitives/Badge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"

import { ADMIN_FIGURE } from "~/ui/recipes/admin"
import { ACTION_ROW } from "~/ui/recipes/layout"
import { META_TEXT } from "~/ui/recipes/text"

import { FundNotFound } from "./FundNotFound"
import { HoldingForm, emptyDraft, isDraftIncomplete } from "./HoldingForm"
import type { StockDraft } from "./HoldingForm"
import { holdingSlot, parseStockWrite, useStockExit, useStockWrite } from "./holdingQueries"
import type { StockBody, StockExitInput } from "./holdingQueries"

const UNSENT = "The holding could not be sent. Reload the page and try again."

const stockOf = (draft: StockDraft): StockBody => ({
  stockName: draft.stockName.trim(),
  quarterLabel: draft.quarterLabel.trim(),
  weightPercent: draft.weightPercent.trim() === "" ? null : Number(draft.weightPercent),
  sortOrder: draft.sortOrder,
})

const rejectionText = (code: string | null, message: string, fields: Readonly<Record<string, readonly string[]>>): string => {
  if (code === "STATE_CONFLICT") return "This holding changed after the page loaded, so nothing was saved. Reload the holdings and try again."
  if (code === "AUTHORIZATION_DENIED") return "Your account cannot change this fund's holdings."
  const details = Object.values(fields).flat().join(" ")
  return details === "" ? message : details
}

const draftOf = (stock: StockBody): StockDraft => ({
  stockName: stock.stockName,
  quarterLabel: stock.quarterLabel,
  weightPercent: stock.weightPercent == null ? "" : String(stock.weightPercent),
  sortOrder: stock.sortOrder ?? 0,
})

const FundHoldings = ({ fundId }: Readonly<{ fundId: string }>): React.ReactElement => {
  const fund = useAdminFund(fundId)
  const stocks = useAdminFundStocks(fundId)
  const write = useHeldWrite(useStockWrite(fundId), UNSENT, {
    slot: holdingSlot(fundId),
    parseBody: parseStockWrite,
    retention: "ordinary",
  })
  const exit = useHeldWrite(useStockExit(fundId), UNSENT)
  const { hasAnyPermission } = useSession()
  const restored = write.held

  const [draft, setDraft] = useState<StockDraft>(() => (restored === null ? emptyDraft() : draftOf(restored.stock)))
  const [editing, setEditing] = useState<string | null>(() => restored?.stockId ?? null)
  const [exiting, setExiting] = useState<StockExitInput | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [hasSubmitted, setHasSubmitted] = useState(false)

  const canWrite = hasAnyPermission(["funds.write"])
  const isLocked = isHeldOrUnreadable(write) || exit.held !== null

  const reload = (): void => {
    void fund.refetch()
    void stocks.refetch()
  }

  useHeldDone(write.outcome, () => {
    setSaved(`${draft.stockName.trim()} ${editing === null ? "added to" : "updated in"} this fund’s holdings.`)
    setDraft({ ...emptyDraft(), quarterLabel: draft.quarterLabel.trim() })
    setEditing(null)
    setHasSubmitted(false)
  })

  const submit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault()
    setHasSubmitted(true)
    setSaved(null)
    if (isDraftIncomplete(draft) || !canWrite || isLocked) return
    write.submit({ stockId: editing, stock: stockOf(draft) })
  }

  if (isUnknownRecord(fund.data, fund.error)) {
    return (
      <Page width="wide">
        <PageHeader title="Holdings" />
        <FundNotFound />
      </Page>
    )
  }

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={fund.data?.fund.slug ?? ""}
        title="Holdings"
        description="The disclosed holdings investors see on the fund. Weights are per quarter, and exiting a holding keeps it in the record rather than deleting it."
      />

      <AsyncBoundary
        query={fund}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="45%" />
            <Skeleton height="1rem" width="70%" />
          </Card>
        }
      >
        {(data) => {
          const isArchived = data.fund.status === "archived"
          return (
            <>
              <PersistedHoldNotices
                write={write}
                subject="the holding was saved"
                onReload={reload}
                reloadLabel="Reload the holdings"
                restartWarning="Check the holdings list first. If this holding is listed, it was saved, and a new attempt would add it a second time. A new attempt cannot be matched to the unconfirmed one."
              />
              {exit.outcome.kind === "unknown" ? (
                <HeldWriteNotice write={exit} subject="the holding was marked exited" onReload={reload} reloadLabel="Reload the holdings" />
              ) : null}
              {write.outcome.kind === "rejected" ? (
                <Alert tone="error" title="Holding not saved">
                  {rejectionText(write.outcome.code, write.outcome.message, write.outcome.fields)}
                </Alert>
              ) : null}
              {exit.outcome.kind === "rejected" ? (
                <Alert tone="error" title="Holding not exited">
                  {rejectionText(exit.outcome.code, exit.outcome.message, exit.outcome.fields)}
                </Alert>
              ) : null}
              {saved === null ? null : <Alert tone="success" title="Holding saved">{saved}</Alert>}
              {isArchived ? <Alert tone="info" title="Archived fund">This fund’s disclosures can no longer be changed.</Alert> : null}

              {canWrite ? (
                <Section title={editing === null ? "Add a holding" : "Edit this holding"}>
                  <HoldingForm
                    draft={draft}
                    setDraft={setDraft}
                    isEditing={editing !== null}
                    isLocked={isLocked}
                    isArchived={isArchived}
                    isPending={write.pending}
                    hasSubmitted={hasSubmitted}
                    onSubmit={submit}
                    onCancel={() => {
                      setEditing(null)
                      setDraft(emptyDraft())
                    }}
                  />
                </Section>
              ) : (
                <Alert tone="info" title="You can read these but not change them">
                  Your role cannot edit holdings.
                </Alert>
              )}

              <AsyncBoundary
                query={stocks}
                skeleton={
                  <Card>
                    <Skeleton height="1rem" width="45%" />
                    <Skeleton height="1rem" width="70%" />
                  </Card>
                }
                isEmpty={(list) => list.items.length === 0}
                empty={
                  <EmptyState
                    title="No holdings disclosed"
                    description="Investors see 'holdings not disclosed' on this fund until you add some."
                  />
                }
              >
                {(list) => {
                  const active = list.items.filter((stock) => stock.state === "active")
                  return (
                    <>
                      {active.length === 0 ? null : (
                        <Section title="What investors see">
                          <FundStockAllocation stocks={active} />
                        </Section>
                      )}

                      <Section title="All holdings">
                        <AdminTable
                          caption="Holdings"
                          rows={list.items}
                          rowKey={(row) => row.id}
                          columns={[
                            { key: "name", header: "Stock", render: (row) => row.stockName },
                            { key: "quarter", header: "Quarter", render: (row) => row.quarterLabel },
                            {
                              key: "weight",
                              header: "Weight",
                              numeric: true,
                              render: (row) =>
                                row.weightPercent === null ? (
                                  <span className={META_TEXT}>Not disclosed</span>
                                ) : (
                                  <span className={ADMIN_FIGURE}>{`${row.weightPercent}%`}</span>
                                ),
                            },
                            { key: "order", header: "Order", numeric: true, render: (row) => String(row.sortOrder) },
                            {
                              key: "state",
                              header: "State",
                              render: (row) => <Badge tone={row.state === "active" ? "positive" : "neutral"}>{row.state}</Badge>,
                            },
                            {
                              key: "exited",
                              header: "Exited",
                              render: (row) => (row.exitedAt === null ? "—" : formatDateTime(row.exitedAt)),
                            },
                            {
                              key: "actions",
                              header: "Actions",
                              render: (row) =>
                                canWrite && !isArchived && row.state === "active" ? (
                                  <span className={ACTION_ROW}>
                                    <Button
                                      tone="ghost"
                                      size="sm"
                                      disabled={isLocked}
                                      onClick={() => {
                                        setSaved(null)
                                        setHasSubmitted(false)
                                        setEditing(row.id)
                                        setDraft({
                                          stockName: row.stockName,
                                          quarterLabel: row.quarterLabel,
                                          weightPercent: row.weightPercent ?? "",
                                          sortOrder: row.sortOrder,
                                        })
                                      }}
                                    >
                                      Edit
                                    </Button>
                                    <Button
                                      tone="danger"
                                      size="sm"
                                      disabled={isLocked}
                                      onClick={() => {
                                        setSaved(null)
                                        setExiting({ stockId: row.id, stockName: row.stockName })
                                      }}
                                    >
                                      Exit
                                    </Button>
                                  </span>
                                ) : (
                                  <span className={META_TEXT}>—</span>
                                ),
                            },
                          ]}
                        />
                      </Section>
                    </>
                  )
                }}
              </AsyncBoundary>
            </>
          )
        }}
      </AsyncBoundary>

      <ConfirmDialog
        open={exiting !== null}
        title={`Mark ${exiting?.stockName ?? "this holding"} as exited?`}
        description="Investors stop seeing it. Nothing is deleted: the holding stays in the record with its exit date, which is what a disclosure history is for."
        confirmLabel="Mark it exited"
        cancelLabel="Cancel"
        confirmTone="danger"
        onConfirm={() => {
          if (exiting === null) return
          setExiting(null)
          exit.submit(exiting)
        }}
        onCancel={() => {
          setExiting(null)
        }}
      />
    </Page>
  )
}

const FundHoldingsScreen = (): React.ReactElement => {
  const { fundId = "" } = useParams()
  return <FundHoldings key={holdingSlot(fundId)} fundId={fundId} />
}

export default FundHoldingsScreen
