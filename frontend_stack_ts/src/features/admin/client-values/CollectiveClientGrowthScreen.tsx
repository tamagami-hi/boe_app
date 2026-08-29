import { useState } from "react"

import { isApiError } from "~/api/errors"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { toPaise } from "~/domain/money"
import {
  useCommitCollectiveClientGrowth,
  usePreviewCollectiveClientGrowth,
} from "~/features/admin/shared/adminQueries"
import { useAdminFundCatalogue } from "~/features/admin/shared/queries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Stat } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { Select } from "~/ui/primitives/Select"

import {
  ADMIN_CODE,
  ADMIN_FIGURE,
  ADMIN_FORM_GRID,
  ADMIN_LABEL,
  ADMIN_SUMMARY_GRID,
} from "~/ui/recipes/admin"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { STACK_LG } from "~/ui/recipes/layout"

const today = (): string => new Date().toISOString().slice(0, 10)

const CollectiveClientGrowthScreen = (): React.ReactElement => {
  const funds = useAdminFundCatalogue()
  const preview = usePreviewCollectiveClientGrowth()
  const commit = useCommitCollectiveClientGrowth()

  const [fundId, setFundId] = useState("")
  const [basisPoints, setBasisPoints] = useState("")
  const [effectiveDate, setEffectiveDate] = useState(today)
  const [reasonCode, setReasonCode] = useState("quarterly_valuation")
  const [note, setNote] = useState("")
  const [failure, setFailure] = useState<string | null>(null)
  const [staleBasis, setStaleBasis] = useState(false)

  const fundOptions = [
    { value: "", label: "Choose a fund" },
    ...(funds.data?.items ?? []).map((fund) => ({ value: fund.id, label: fund.name ?? fund.slug })),
  ]

  const rate = Number(basisPoints)
  const invalidRate = !Number.isInteger(rate) || rate === 0
  const plan = staleBasis ? null : (preview.data ?? null)

  const clearPreview = (): void => {
    preview.reset()
    commit.reset()
    setStaleBasis(false)
  }

  const runPreview = (): void => {
    setFailure(null)
    setStaleBasis(false)
    commit.reset()
    preview.mutate(
      { fundId, growthBasisPoints: rate },
      {
        onError: (error) => {
          setFailure(
            isApiError(error)
              ? error.code === "STATE_CONFLICT"
                ? "This fund has no position a growth batch could apply to, or every adjustment would round to nothing."
                : error.message
              : "We could not build a preview. Nothing has changed.",
          )
        },
      },
    )
  }

  const runCommit = (): void => {
    if (plan === null) return
    setFailure(null)
    commit.mutate(
      {
        fundId,
        growthBasisPoints: rate,
        basisHash: plan.basisHash,
        effectiveDate,
        reasonCode: reasonCode.trim(),
        ...(note.trim() === "" ? {} : { note: note.trim() }),
      },
      {
        onError: (error) => {
          if (isApiError(error) && error.code === "STATE_CONFLICT") {
            setStaleBasis(true)
            setFailure(
              "Someone changed a value in this fund after the preview was taken, so the preview is void. Nothing was written. Run a new preview and read it before committing.",
            )
            return
          }
          setFailure(
            isApiError(error)
              ? error.message
              : "We could not commit that batch. Nothing has been written.",
          )
        },
      },
    )
  }

  const committed = commit.data ?? null

  return (
    <Page width="wide">
      <PageHeader
        title="Adjust a whole fund"
        description="Preview every position first. Committing sends the preview's basis back; if anything in the fund moved since, the commit is refused rather than applied to different numbers."
      />

      {failure === null ? null : (
        <Alert tone={staleBasis ? "warning" : "error"} title="Nothing was written">
          {failure}
        </Alert>
      )}

      {committed === null ? null : (
        <Alert tone="success" title="Batch committed">
          {`${String(committed.targetCount)} position(s) adjusted. Every investor in the batch has been notified.`}
        </Alert>
      )}

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
                    clearPreview()
                  }}
                />
              )}
            </FormField>

            <FormField
              label="Rate in basis points"
              required
              hint="250 is +2.5%. Applied to every eligible position."
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
          </div>

          <Button
            tone="secondary"
            disabled={fundId === "" || invalidRate}
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
                <Stat label="Positions adjusted">
                  <span className={ADMIN_FIGURE}>{String(plan.targetCount)}</span>
                </Stat>
                <Stat label="Excluded" hint="Zero-value positions cannot take a rate.">
                  <span className={ADMIN_FIGURE}>{String(plan.excludedCount)}</span>
                </Stat>
                <Stat label="Total change">
                  <MoneyValue
                    amount={toPaise(plan.totalDeltaPaise)}
                    size="md"
                    tone="signed"
                    showSign
                  />
                </Stat>
                <Stat label="Mode">
                  <span>{plan.mode === "percentage" ? "Rate" : "Explicit amounts"}</span>
                </Stat>
              </div>
              <span className={ADMIN_LABEL}>Basis</span>
              <span className={ADMIN_CODE}>{plan.basisHash}</span>
              <p className={PROSE_SM}>
                These numbers are the server&apos;s, not this browser&apos;s. On commit the server
                recomputes them from the same positions and refuses the write if the basis moved.
              </p>
            </Card>
          </Section>

          <Section title="Every position in the batch">
            <AdminTable
              caption="Preview targets"
              rows={plan.targets}
              rowKey={(row) => row.userId}
              columns={[
                {
                  key: "user",
                  header: "Investor",
                  render: (row) => <span className={ADMIN_CODE}>{row.userId}</span>,
                },
                {
                  key: "before",
                  header: "Before",
                  numeric: true,
                  render: (row) => <MoneyValue amount={toPaise(row.beforePaise)} size="sm" />,
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
                  render: (row) => <MoneyValue amount={toPaise(row.afterPaise)} size="sm" />,
                },
              ]}
            />
          </Section>

          <Section
            title="Commit the batch"
            description="This writes one growth entry per position and notifies every investor in it."
          >
            <Card>
              <div className={STACK_LG}>
                <div className={ADMIN_FORM_GRID}>
                  <FormField
                    label="Effective date"
                    required
                    hint="Decides which month's statement these entries land in."
                  >
                    {({ id }) => (
                      <Input
                        id={id}
                        type="date"
                        value={effectiveDate}
                        onChange={(event) => {
                          setEffectiveDate(event.target.value)
                        }}
                      />
                    )}
                  </FormField>

                  <FormField label="Reason code" required>
                    {({ id }) => (
                      <Input
                        id={id}
                        value={reasonCode}
                        maxLength={80}
                        onChange={(event) => {
                          setReasonCode(event.target.value)
                        }}
                      />
                    )}
                  </FormField>
                </div>

                <FormField label="Note" hint="Internal. Recorded on the batch.">
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
                  disabled={reasonCode.trim() === "" || effectiveDate === ""}
                  loading={commit.isPending}
                  onClick={runCommit}
                  trailing
                >
                  {`Commit ${String(plan.targetCount)} adjustment(s)`}
                </Button>
              </div>
            </Card>
          </Section>
        </>
      )}
    </Page>
  )
}

export default CollectiveClientGrowthScreen
