import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { useQueryClient } from "@tanstack/react-query"
import type { UseMutationResult } from "@tanstack/react-query"
import type { z } from "zod"

import { hasCode, isApiError, isUnknownWriteOutcome } from "~/api/errors"
import {
  commitAdminCollectiveAumGrowth,
  previewAdminCollectiveAumGrowth,
} from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { useIdempotencyKey } from "~/api/idempotency"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useApi } from "~/app/providers/ApiProvider"
import { toPaise } from "~/domain/money"
import { useAdminFundCatalogue } from "~/features/admin/shared/queries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { Stat } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"

import {
  ADMIN_CODE,
  ADMIN_FIGURE,
  ADMIN_FILTER,
  ADMIN_FILTER_ROW,
  ADMIN_FORM_GRID,
  ADMIN_LABEL,
  ADMIN_SUMMARY_GRID,
} from "~/ui/recipes/admin"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { STACK_LG, STACK_SM } from "~/ui/recipes/layout"

type PreviewInput = z.input<typeof previewAdminCollectiveAumGrowth.request.body>
type CommitInput = z.input<typeof commitAdminCollectiveAumGrowth.request.body>
type HeldCommit = Readonly<{ body: CommitInput; idempotencyKey: string }>
type Catalogue = ReturnType<typeof useAdminFundCatalogue>
type CatalogueFund = NonNullable<Catalogue["data"]>["items"][number]
type Failure = Readonly<{ isUnknown: boolean; message: string }>

const today = (): string => new Date().toISOString().slice(0, 10)

const usePreview = (): UseMutationResult<
  DataOf<typeof previewAdminCollectiveAumGrowth>,
  Error,
  PreviewInput
> => {
  const api = useApi()
  return useMutation({
    mutationFn: async (body: PreviewInput) =>
      (await api.request(previewAdminCollectiveAumGrowth, { body })).data,
  })
}

const useCommit = (): UseMutationResult<
  DataOf<typeof commitAdminCollectiveAumGrowth>,
  Error,
  HeldCommit
> => {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ body, idempotencyKey }: HeldCommit) =>
      (await api.request(commitAdminCollectiveAumGrowth, { body, idempotencyKey })).data,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "funds"] })
      await queryClient.invalidateQueries({ queryKey: ["admin", "fund"] })
    },
  })
}

const initialisedFunds = (items: readonly CatalogueFund[]): readonly CatalogueFund[] =>
  items.filter((fund) => fund.aum !== null)

const commitFailure = (error: unknown): Failure => {
  if (isUnknownWriteOutcome(error)) {
    return {
      isUnknown: true,
      message:
        "The reply did not arrive, so it is not known whether these fund sizes were updated. Check each fund's AUM history before going on. Committing this same preview again will not apply it twice.",
    }
  }
  return { isUnknown: false, message: isApiError(error) ? error.message : "We could not commit that batch." }
}

type FundChoicesProps = Readonly<{
  funds: Catalogue
  selected: readonly string[]
  onToggle: (fundId: string) => void
}>

const FundChoices = ({ funds, selected, onToggle }: FundChoicesProps): React.ReactElement => (
  <AsyncBoundary
    query={funds}
    skeleton={<Skeleton height="2rem" width="60%" />}
    isEmpty={(data) => initialisedFunds(data.items).length === 0}
    empty={
      <p className={PROSE_SM}>
        No fund has a recorded size yet, so there is nothing to grow. Record a fund&apos;s opening AUM first.
      </p>
    }
  >
    {(data) => (
      <div className={STACK_SM}>
        {funds.error === null || funds.error === undefined ? null : (
          <Alert
            tone="warning"
            title="The fund list may be incomplete"
            action={
              <Button tone="secondary" size="sm" onClick={funds.refetch}>
                Try again
              </Button>
            }
          >
            Some funds could not be loaded, so a fund you expect may be missing here.
          </Alert>
        )}
        <div className={ADMIN_FILTER_ROW}>
          {initialisedFunds(data.items).map((fund) => (
            <button
              key={fund.id}
              type="button"
              aria-pressed={selected.includes(fund.id)}
              className={ADMIN_FILTER}
              onClick={() => {
                onToggle(fund.id)
              }}
            >
              {fund.name ?? fund.slug}
            </button>
          ))}
        </div>
      </div>
    )}
  </AsyncBoundary>
)

const CollectiveAumGrowthScreen = (): React.ReactElement => {
  const funds = useAdminFundCatalogue()
  const preview = usePreview()
  const commit = useCommit()

  const [selected, setSelected] = useState<readonly string[]>([])
  const [basisPoints, setBasisPoints] = useState("")
  const [asOfDate, setAsOfDate] = useState(today)
  const [reasonCode, setReasonCode] = useState("periodic_growth")
  const [note, setNote] = useState("")
  const [failure, setFailure] = useState<Failure | null>(null)
  const [staleBasis, setStaleBasis] = useState(false)

  const initialised = initialisedFunds(funds.data?.items ?? [])
  const rate = Number(basisPoints)
  const invalidRate = !Number.isInteger(rate) || rate === 0
  const plan = staleBasis ? null : (preview.data ?? null)
  const trimmedNote = note.trim()
  const commitBody: CommitInput | null =
    plan === null
      ? null
      : {
          asOfDate,
          reasonCode: reasonCode.trim(),
          ...(trimmedNote === "" ? {} : { note: trimmedNote }),
          fundIds: [...selected],
          growthBasisPoints: rate,
          basisHash: plan.basisHash,
        }
  const commitKey = useIdempotencyKey(commitBody)

  const nameFor = (fundId: string): string => {
    const fund = initialised.find((entry) => entry.id === fundId)
    return fund?.name ?? fund?.slug ?? fundId
  }

  const clearPreview = (): void => {
    preview.reset()
    commit.reset()
    setStaleBasis(false)
  }

  const toggle = (fundId: string): void => {
    clearPreview()
    setSelected((current) =>
      current.includes(fundId)
        ? current.filter((entry) => entry !== fundId)
        : [...current, fundId],
    )
  }

  const runPreview = (): void => {
    setFailure(null)
    setStaleBasis(false)
    commit.reset()
    preview.mutate(
      { asOfDate, reasonCode: reasonCode.trim(), fundIds: [...selected], growthBasisPoints: rate },
      {
        onError: (error) => {
          setFailure({
            isUnknown: false,
            message: isApiError(error)
              ? error.code === "STATE_CONFLICT"
                ? "One of these funds has no size recorded, or every change would round to nothing."
                : error.message
              : "We could not build a preview. Nothing has changed.",
          })
        },
      },
    )
  }

  const runCommit = (): void => {
    if (commitBody === null) return
    setFailure(null)
    commit.mutate(
      { body: commitBody, idempotencyKey: commitKey },
      {
        onError: (error) => {
          if (hasCode(error, "STATE_CONFLICT")) {
            setStaleBasis(true)
            setFailure({
              isUnknown: false,
              message:
                "One of these funds changed size after the preview was taken, so the preview is void. Nothing was written. Run a new preview and read it before committing.",
            })
            return
          }
          setFailure(commitFailure(error))
        },
      },
    )
  }

  return (
    <Page width="wide">
      <PageHeader
        title="Grow several funds"
        description="Apply one rate to several funds at once. Preview first; the commit carries the preview's basis so a fund that moved in between blocks the write instead of taking the wrong number."
      />

      {failure === null ? null : (
        <Alert
          tone={staleBasis || failure.isUnknown ? "warning" : "error"}
          title={failure.isUnknown ? "Outcome unknown" : "Nothing was written"}
        >
          {failure.message}
        </Alert>
      )}

      {commit.data === undefined ? null : (
        <Alert tone="success" title="Batch committed">
          {`${String(commit.data.targetCount)} fund size(s) updated.`}
        </Alert>
      )}

      <Card elevated>
        <div className={STACK_LG}>
          <FormField label="Funds" required hint="Only funds with a recorded size can be grown.">
            {() => <FundChoices funds={funds} selected={selected} onToggle={toggle} />}
          </FormField>

          <div className={ADMIN_FORM_GRID}>
            <FormField
              label="Rate in basis points"
              required
              hint="250 is +2.5%, applied to each selected fund's current size."
              {...(invalidRate && basisPoints !== ""
                ? { error: "Enter a whole non-zero number of basis points." }
                : {})}
            >
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  value={basisPoints}
                  onChange={(event) => {
                    setBasisPoints(event.target.value)
                    clearPreview()
                  }}
                />
              )}
            </FormField>

            <FormField label="As of" required>
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={asOfDate}
                  onChange={(event) => {
                    setAsOfDate(event.target.value)
                    clearPreview()
                  }}
                />
              )}
            </FormField>
          </div>

          <FormField label="Reason code" required>
            {({ id }) => (
              <Input
                id={id}
                value={reasonCode}
                maxLength={80}
                onChange={(event) => {
                  setReasonCode(event.target.value)
                  clearPreview()
                }}
              />
            )}
          </FormField>

          <Button
            tone="secondary"
            disabled={selected.length === 0 || invalidRate || reasonCode.trim() === ""}
            loading={preview.isPending}
            onClick={runPreview}
          >
            Preview the batch
          </Button>
        </div>
      </Card>

      {plan === null ? null : (
        <>
          <Section title="What this would do">
            <Card>
              <div className={ADMIN_SUMMARY_GRID}>
                <Stat label="Funds">
                  <span className={ADMIN_FIGURE}>{String(plan.items.length)}</span>
                </Stat>
                <Stat label="Rate">
                  <span className={ADMIN_FIGURE}>{`${basisPoints} bps`}</span>
                </Stat>
                <Stat label="As of">
                  <span>{asOfDate}</span>
                </Stat>
              </div>
              <span className={ADMIN_LABEL}>Basis</span>
              <span className={ADMIN_CODE}>{plan.basisHash}</span>
            </Card>
          </Section>

          <Section title="Every fund in the batch">
            <AdminTable
              caption="Preview items"
              rows={plan.items}
              rowKey={(row) => row.fundId}
              columns={[
                { key: "fund", header: "Fund", render: (row) => nameFor(row.fundId) },
                {
                  key: "revision",
                  header: "Basis revision",
                  numeric: true,
                  render: (row) => String(row.basisRevision),
                },
                {
                  key: "before",
                  header: "Before",
                  numeric: true,
                  render: (row) => <MoneyValue amount={toPaise(row.beforeAumPaise)} size="sm" />,
                },
                {
                  key: "delta",
                  header: "Change",
                  numeric: true,
                  render: (row) => (
                    <MoneyValue
                      amount={toPaise(row.deltaPaise)}
                      size="sm"
                      tone="signed"
                      showSign
                    />
                  ),
                },
                {
                  key: "after",
                  header: "After",
                  numeric: true,
                  render: (row) => <MoneyValue amount={toPaise(row.afterAumPaise)} size="sm" />,
                },
              ]}
            />
          </Section>

          <Section title="Commit the batch">
            <Card>
              <div className={STACK_LG}>
                <FormField label="Note" hint="Internal. Recorded on every snapshot in the batch.">
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
                <Button loading={commit.isPending} onClick={runCommit} trailing>
                  {`Commit ${String(plan.items.length)} fund size(s)`}
                </Button>
              </div>
            </Card>
          </Section>
        </>
      )}
    </Page>
  )
}

export default CollectiveAumGrowthScreen
