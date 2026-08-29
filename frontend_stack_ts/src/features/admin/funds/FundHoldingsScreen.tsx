import { useState } from "react"
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
import { DonutChart } from "~/ui/charts/DonutChart"
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

const EMPTY: StockDraft = { stockName: "", quarterLabel: "", weightPercent: "", sortOrder: 0 }

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
      await queryClient.invalidateQueries({ queryKey: qk.admin.fundStocks(fundId) })
      await queryClient.invalidateQueries({ queryKey: qk.admin.fund(fundId) })
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
      await queryClient.invalidateQueries({ queryKey: qk.admin.fundStocks(fundId) })
      await queryClient.invalidateQueries({ queryKey: qk.admin.fund(fundId) })
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

  const [draft, setDraft] = useState<StockDraft>(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  const [exiting, setExiting] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const canWrite = hasAnyPermission(["funds.write"])
  const badQuarter = draft.quarterLabel !== "" && !QUARTER_PATTERN.test(draft.quarterLabel.trim())
  const weight = Number(draft.weightPercent)
  const badWeight =
    draft.weightPercent.trim() !== "" &&
    (!Number.isFinite(weight) || weight < 0 || weight > 100)
  const incomplete = draft.stockName.trim() === "" || badQuarter || badWeight || draft.quarterLabel === ""

  const describe = (error: unknown): string =>
    isApiError(error)
      ? error.code === "STATE_CONFLICT"
        ? "This holding changed while you were editing it. Reload and try again."
        : error.message
      : "We could not save that. Nothing has changed."

  const submit = (): void => {
    setFailure(null)
    write.mutate(
      { ...(editing === null ? {} : { stockId: editing }), body: draft },
      {
        onError: (error) => {
          setFailure(describe(error))
        },
        onSuccess: () => {
          setDraft(EMPTY)
          setEditing(null)
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
        <Alert tone="error" title="Nothing changed">
          {failure}
        </Alert>
      )}

      {canWrite ? (
        <Section title={editing === null ? "Add a holding" : "Edit this holding"}>
          <Card elevated>
            <div className={STACK_LG}>
              <div className={ADMIN_FORM_GRID}>
                <FormField label="Stock name" required>
                  {({ id }) => (
                    <Input
                      id={id}
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
                  hint="Exactly like Q1 FY26."
                  {...(badQuarter ? { error: "Use the form Q1 FY26." } : {})}
                >
                  {({ id }) => (
                    <Input
                      id={id}
                      value={draft.quarterLabel}
                      placeholder="Q1 FY26"
                      onChange={(event) => {
                        setDraft({ ...draft, quarterLabel: event.target.value })
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
                  {({ id }) => (
                    <Input
                      id={id}
                      value={draft.weightPercent}
                      onChange={(event) => {
                        setDraft({ ...draft, weightPercent: event.target.value })
                      }}
                    />
                  )}
                </FormField>

                <FormField label="Sort order" hint="Lower numbers appear first.">
                  {({ id }) => (
                    <Input
                      id={id}
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
                <Button disabled={incomplete} loading={write.isPending} onClick={submit} trailing>
                  {editing === null ? "Add the holding" : "Save the holding"}
                </Button>
                {editing === null ? null : (
                  <Button
                    tone="ghost"
                    onClick={() => {
                      setEditing(null)
                      setDraft(EMPTY)
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
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
            (stock) => stock.state === "active" && stock.weightPercent !== null,
          )
          return (
            <>
              {active.length === 0 ? null : (
                <Section title="What investors see">
                  <Card>
                    <DonutChart
                      centreLabel="Holdings"
                      centreValue={String(active.length)}
                      slices={active.map((stock) => ({
                        key: stock.id,
                        label: stock.stockName,
                        value: Number(stock.weightPercent ?? "0"),
                      }))}
                    />
                  </Card>
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
                        canWrite && row.state === "active" ? (
                          <span className={ACTION_ROW}>
                            <Button
                              tone="ghost"
                              size="sm"
                              disabled={write.isPending}
                              onClick={() => {
                                setFailure(null)
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
