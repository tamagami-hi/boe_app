import { useState, type SyntheticEvent } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult } from "@tanstack/react-query"
import { useParams } from "react-router-dom"

import { isApiError } from "~/api/errors"
import {
  addAdminFundStock,
  editAdminFundStock,
  exitAdminFundStock,
} from "~/api/generated/operations"
import { mintIdempotencyKey } from "~/api/idempotency"
import { qk } from "~/api/queryKeys"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useApi } from "~/app/providers/ApiProvider"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { useAdminFundStocks } from "~/features/admin/shared/adminQueries"
import { useAdminFund } from "~/features/admin/shared/queries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { FundStockAllocation } from "~/features/funds/FundStockAllocation"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { Badge } from "~/ui/primitives/Badge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"

import { ADMIN_FIGURE, ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"
import { META_TEXT } from "~/ui/recipes/text"

type StockDraft = Readonly<{
  stockName: string
  quarterLabel: string
  weightPercent: string
  sortOrder: number
}>

const FISCAL_YEAR_START_MONTH = 3
const MONTHS_PER_QUARTER = 3
const MONTHS_PER_YEAR = 12

const emptyDraft = (): StockDraft => {
  const now = new Date()
  const month = now.getMonth()
  const quarter = Math.floor(((month - FISCAL_YEAR_START_MONTH + MONTHS_PER_YEAR) % MONTHS_PER_YEAR) / MONTHS_PER_QUARTER) + 1
  const year = now.getFullYear() + (month >= FISCAL_YEAR_START_MONTH ? 1 : 0)
  return { stockName: "", quarterLabel: `Q${String(quarter)} FY${String(year).slice(-2)}`, weightPercent: "", sortOrder: 0 }
}

const QUARTER_PATTERN = /^Q[1-4] FY[0-9]{2}$/u

const useStockWrite = (
  fundId: string,
): UseMutationResult<
  void,
  Error,
  Readonly<{ stockId?: string; body: StockDraft }>
> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ stockId, body }: Readonly<{ stockId?: string; body: StockDraft }>) => {
      const payload = {
        stockName: body.stockName.trim(),
        quarterLabel: body.quarterLabel.trim(),
        weightPercent: body.weightPercent.trim() === "" ? null : Number(body.weightPercent),
        sortOrder: body.sortOrder,
      }
      if (stockId === undefined) {
        await api.request(addAdminFundStock, {
          params: { fundId },
          body: payload,
          idempotencyKey: mintIdempotencyKey(),
        })
        return
      }
      await api.request(editAdminFundStock, {
        params: { fundId, stockId },
        body: payload,
        idempotencyKey: mintIdempotencyKey(),
      })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.admin.fund(fundId) }),
        queryClient.invalidateQueries({ queryKey: ["admin", "funds"] }),
        queryClient.invalidateQueries({ queryKey: qk.client.fund(fundId) }),
      ])
    },
  })
}

const useStockExit = (fundId: string): UseMutationResult<void, Error, string> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (stockId: string) => {
      await api.request(exitAdminFundStock, {
        params: { fundId, stockId },
        idempotencyKey: mintIdempotencyKey(),
      })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.admin.fund(fundId) }),
        queryClient.invalidateQueries({ queryKey: ["admin", "funds"] }),
        queryClient.invalidateQueries({ queryKey: qk.client.fund(fundId) }),
      ])
    },
  })
}

const FundHoldingsScreen = (): React.ReactElement => {
  const { fundId = "" } = useParams()
  const fund = useAdminFund(fundId)
  const stocks = useAdminFundStocks(fundId)
  const write = useStockWrite(fundId)
  const exit = useStockExit(fundId)
  const { hasAnyPermission } = useSession()

  const [draft, setDraft] = useState<StockDraft>(emptyDraft)
  const [editing, setEditing] = useState<string | null>(null)
  const [exiting, setExiting] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [hasSubmitted, setHasSubmitted] = useState(false)

  const canWrite = hasAnyPermission(["funds.write"])
  const badQuarter = !QUARTER_PATTERN.test(draft.quarterLabel.trim())
  const weight = Number(draft.weightPercent)
  const badWeight =
    draft.weightPercent.trim() !== "" &&
    (!Number.isFinite(weight) || weight < 0 || weight > 100)
  const badName = draft.stockName.trim() === ""
  const badSortOrder = !Number.isInteger(draft.sortOrder) || draft.sortOrder < 0 || draft.sortOrder > 100_000
  const incomplete = badName || badQuarter || badWeight || badSortOrder
  const isArchived = fund.data?.fund.status === "archived"

  const describe = (error: unknown): string =>
    isApiError(error)
      ? error.code === "STATE_CONFLICT"
        ? "This holding changed while you were editing it. Reload and try again."
        : Object.values(error.fields ?? {}).flat().join(" ") || error.message
      : "We could not confirm the save. Refresh the list before trying again."

  const submit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault()
    setHasSubmitted(true)
    setFailure(null)
    setSuccess(null)
    if (incomplete || !canWrite || isArchived || write.isPending) return
    write.mutate(
      { ...(editing === null ? {} : { stockId: editing }), body: draft },
      {
        onError: (error) => {
          setFailure(describe(error))
        },
        onSuccess: () => {
          setSuccess(`${draft.stockName.trim()} ${editing === null ? "added to" : "updated in"} this fund’s holdings.`)
          setDraft({ ...emptyDraft(), quarterLabel: draft.quarterLabel.trim() })
          setEditing(null)
          setHasSubmitted(false)
        },
      },
    )
  }

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={fund.data?.fund.slug ?? ""}
        title="Holdings"
        description="The disclosed holdings investors see on the fund. Weights are per quarter, and exiting a holding keeps it in the record rather than deleting it."
      />

      {failure === null ? null : (
        <Alert tone="error" title="Save not confirmed">
          {failure}
        </Alert>
      )}

      {success === null ? null : <Alert tone="success" title="Holding saved">{success}</Alert>}
      {isArchived ? <Alert tone="info" title="Archived fund">This fund’s disclosures can no longer be changed.</Alert> : null}

      {canWrite ? (
        <Section title={editing === null ? "Add a holding" : "Edit this holding"}>
          <Card elevated>
            <form className={STACK_LG} onSubmit={submit} noValidate>
              <div className={ADMIN_FORM_GRID}>
                <FormField label="Stock name" required error={hasSubmitted && badName ? "Enter the stock name." : undefined}>
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={draft.stockName}
                      maxLength={200}
                      onChange={(event) => {
                        setDraft({ ...draft, stockName: event.target.value })
                      }}
                    />
                  )}
                </FormField>

                <FormField
                  label="Quarter"
                  required
                  hint="Reporting quarter, prefilled for the current financial year. You can change it."
                  {...(badQuarter && (hasSubmitted || draft.quarterLabel !== "") ? { error: "Enter a reporting quarter like Q1 FY26." } : {})}
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={draft.quarterLabel}
                      placeholder="Q1 FY26"
                      onChange={(event) => {
                        setDraft({ ...draft, quarterLabel: event.target.value.toUpperCase() })
                      }}
                    />
                  )}
                </FormField>
              </div>

              <div className={ADMIN_FORM_GRID}>
                <FormField
                  label="Weight percent"
                  hint="Leave empty to disclose the holding without a weight."
                  {...(badWeight ? { error: "Enter a percentage between 0 and 100." } : {})}
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={draft.weightPercent}
                      onChange={(event) => {
                        setDraft({ ...draft, weightPercent: event.target.value })
                      }}
                    />
                  )}
                </FormField>

                <FormField label="Sort order" hint="Lower numbers appear first." error={badSortOrder ? "Enter a whole number from 0 to 100,000." : undefined}>
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      type="number"
                      min={0}
                      max={100_000}
                      value={String(draft.sortOrder)}
                      onChange={(event) => {
                        setDraft({ ...draft, sortOrder: Number(event.target.value) })
                      }}
                    />
                  )}
                </FormField>
              </div>

              <div className={ACTION_ROW}>
                <Button type="submit" disabled={isArchived} loading={write.isPending} trailing>
                  {editing === null ? "Add the holding" : "Save the holding"}
                </Button>
                {editing === null ? null : (
                  <Button
                    tone="ghost"
                    onClick={() => {
                      setEditing(null)
                      setDraft(emptyDraft())
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          </Card>
        </Section>
      ) : (
        <Alert tone="info" title="You can read these but not change them">
          Editing holdings needs the funds.write permission.
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
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            title="No holdings disclosed"
            description="Investors see 'holdings not disclosed' on this fund until you add some."
          />
        }
      >
        {(data) => {
          const active = data.items.filter(
            (stock) => stock.state === "active",
          )
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
                  rows={data.items}
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
                    {
                      key: "order",
                      header: "Order",
                      numeric: true,
                      render: (row) => String(row.sortOrder),
                    },
                    {
                      key: "state",
                      header: "State",
                      render: (row) => (
                        <Badge tone={row.state === "active" ? "positive" : "neutral"}>
                          {row.state}
                        </Badge>
                      ),
                    },
                    {
                      key: "exited",
                      header: "Exited",
                      render: (row) =>
                        row.exitedAt === null ? "—" : formatDateTime(row.exitedAt),
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
                              disabled={write.isPending}
                              onClick={() => {
                                setFailure(null)
                                setSuccess(null)
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
                              disabled={exit.isPending}
                              onClick={() => {
                                setFailure(null)
                                setSuccess(null)
                                setExiting(row.id)
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

      <ConfirmDialog
        open={exiting !== null}
        title="Mark this holding as exited?"
        description="Investors stop seeing it. Nothing is deleted: the holding stays in the record with its exit date, which is what a disclosure history is for."
        confirmLabel="Mark it exited"
        confirmTone="danger"
        pending={exit.isPending}
        onConfirm={() => {
          if (exiting === null) return
          setFailure(null)
          exit.mutate(exiting, {
            onError: (error) => {
              setFailure(describe(error))
            },
            onSettled: () => {
              setExiting(null)
            },
          })
        }}
        onCancel={() => {
          setExiting(null)
        }}
      />
    </Page>
  )
}

export default FundHoldingsScreen
