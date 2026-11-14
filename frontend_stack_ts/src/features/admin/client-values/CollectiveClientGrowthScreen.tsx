import { useState } from "react"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { useIdempotencyKey } from "~/api/idempotency"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { useAdminFundCatalogue } from "~/features/admin/shared/queries"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { DataList, DetailRow, Stat } from "~/ui/patterns/DataList"
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
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

import { CatalogueFundPicker } from "./CatalogueFundPicker"
import { CollectivePreviewTable } from "./CollectivePreviewTable"
import { useCommitCollectiveClientGrowth, usePreviewCollectiveClientGrowth } from "./growthQueries"
import type { CollectiveGrowthCommitInput } from "./growthQueries"
import { DEFAULT_GROWTH_REASON, GROWTH_REASON_OPTIONS } from "./growthReasons"
import { indiaToday } from "./indiaToday"

const MIN_BASIS_POINTS = -2_000
const MAX_BASIS_POINTS = 2_000

const STALE_BASIS_MESSAGE =
  "Someone changed a value in this fund after the preview was taken, so the preview is void. Nothing was written. Run a new preview and read it before committing."

type CommitOutcome =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "rejected"; message: string; stale: boolean }>
  | Readonly<{ kind: "unknown" }>

const IDLE: CommitOutcome = { kind: "idle" }

const describeCommitRejection = (error: unknown): CommitOutcome => {
  if (isUnknownWriteOutcome(error)) return { kind: "unknown" }
  if (isApiError(error) && error.code === "STATE_CONFLICT") {
    return { kind: "rejected", message: STALE_BASIS_MESSAGE, stale: true }
  }
  return {
    kind: "rejected",
    message: isApiError(error) ? error.message : "This batch could not be sent. Reload the page and try again.",
    stale: false,
  }
}

const CollectiveClientGrowthScreen = (): React.ReactElement => {
  const funds = useAdminFundCatalogue()
  const preview = usePreviewCollectiveClientGrowth()
  const commit = useCommitCollectiveClientGrowth()

  const [fundId, setFundId] = useState("")
  const [basisPoints, setBasisPoints] = useState("")
  const [effectiveDate, setEffectiveDate] = useState(indiaToday)
  const [reasonCode, setReasonCode] = useState<string>(DEFAULT_GROWTH_REASON)
  const [note, setNote] = useState("")
  const [previewFailure, setPreviewFailure] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [outcome, setOutcome] = useState<CommitOutcome>(IDLE)
  const [held, setHeld] = useState<CollectiveGrowthCommitInput | null>(null)
  const [confirmingRestart, setConfirmingRestart] = useState(false)
  const [confirmingCommit, setConfirmingCommit] = useState(false)

  const fund = (funds.data?.items ?? []).find((entry) => entry.id === fundId)
  const fundLabel = fund?.name ?? fund?.slug ?? fundId

  const rate = Number(basisPoints)
  const invalidRate =
    !Number.isInteger(rate) || rate === 0 || rate < MIN_BASIS_POINTS || rate > MAX_BASIS_POINTS
  const staleBasis = outcome.kind === "rejected" && outcome.stale
  const plan = staleBasis ? null : (preview.data ?? null)
  const committed = commit.data ?? null
  const locked = commit.isPending || outcome.kind === "unknown" || committed !== null
  const today = indiaToday()
  const futureDated = effectiveDate > today

  const trimmedNote = note.trim()
  const commitBody =
    plan === null
      ? null
      : {
          fundId,
          growthBasisPoints: rate,
          basisHash: plan.basisHash,
          effectiveDate,
          reasonCode,
          ...(trimmedNote === "" ? {} : { note: trimmedNote }),
        }
  const idempotencyKey = useIdempotencyKey({ body: commitBody, attempt })

  const clearPreview = (): void => {
    preview.reset()
    commit.reset()
    setOutcome(IDLE)
    setHeld(null)
  }

  const runPreview = (): void => {
    setPreviewFailure(null)
    clearPreview()
    preview.mutate(
      { fundId, growthBasisPoints: rate },
      {
        onError: (error) => {
          setPreviewFailure(
            isApiError(error)
              ? error.code === "STATE_CONFLICT"
                ? "This fund has no position a growth batch could apply to, or every adjustment would round to nothing."
                : error.message
              : "We could not build a preview. A preview never writes anything.",
          )
        },
      },
    )
  }

  const sendCommit = (input: CollectiveGrowthCommitInput): void => {
    setHeld(input)
    setOutcome(IDLE)
    commit.mutate(input, {
      onError: (error) => {
        setOutcome(describeCommitRejection(error))
      },
    })
  }

  const runCommit = (): void => {
    setConfirmingCommit(false)
    if (commitBody === null) return
    sendCommit({ idempotencyKey, body: commitBody })
  }

  const checkAgain = (): void => {
    if (held !== null) sendCommit(held)
  }

  const startOver = (): void => {
    setConfirmingRestart(false)
    setAttempt((current) => current + 1)
    clearPreview()
  }

  const startAnotherBatch = (): void => {
    setBasisPoints("")
    setNote("")
    startOver()
  }

  return (
    <Page width="wide">
      <PageHeader
        title="Adjust a whole fund"
        description="A rate is measured against each investor's own amount invested, so it does not compound. Preview every position first. Committing sends the preview's basis back; if anything in the fund moved since, the commit is refused rather than applied to different numbers."
      />

      {previewFailure === null ? null : (
        <Alert tone="error" title="No preview">
          {previewFailure}
        </Alert>
      )}

      {outcome.kind === "rejected" ? (
        <Alert tone={outcome.stale ? "warning" : "error"} title="Nothing was written">
          {outcome.message}
        </Alert>
      ) : null}

      {outcome.kind === "unknown" ? (
        <Alert
          tone="warning"
          title="Not confirmed"
          action={
            <span className={ACTION_ROW}>
              <Button size="sm" loading={commit.isPending} onClick={checkAgain}>
                Check again
              </Button>
              <Button
                size="sm"
                tone="secondary"
                disabled={commit.isPending}
                onClick={() => {
                  setConfirmingRestart(true)
                }}
              >
                Start over
              </Button>
            </span>
          }
        >
          The reply did not arrive, so it is not known whether this batch was committed. The commit is
          held on this exact request. Check again sends it once more under the same key, and the same
          request can only ever be committed once.
        </Alert>
      ) : null}

      {committed === null ? null : (
        <Alert
          tone="success"
          title="Batch committed"
          action={
            <Button size="sm" tone="secondary" onClick={startAnotherBatch}>
              Start another batch
            </Button>
          }
        >
          {`${String(committed.targetCount)} position(s) adjusted. Every investor in the batch has been notified.`}
        </Alert>
      )}

      <Card elevated>
        <div className={STACK_LG}>
          <div className={ADMIN_FORM_GRID}>
            <CatalogueFundPicker
              value={fundId}
              disabled={locked}
              onChange={(next) => {
                setFundId(next)
                clearPreview()
              }}
            />

            <FormField
              label="Rate in basis points"
              required
              hint="Between -2000 and 2000. 250 is +2.5% of each investor's amount invested."
              {...(invalidRate && basisPoints !== ""
                ? { error: "Enter a whole non-zero rate between -2000 and 2000 basis points." }
                : {})}
            >
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  min={MIN_BASIS_POINTS}
                  max={MAX_BASIS_POINTS}
                  value={basisPoints}
                  disabled={locked}
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
            disabled={locked || fundId === "" || invalidRate}
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
                    showDecimals
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
            <CollectivePreviewTable targets={plan.targets} />
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
                    error={futureDated ? "The effective date cannot be later than today in India." : undefined}
                  >
                    {({ id }) => (
                      <Input
                        id={id}
                        type="date"
                        max={today}
                        value={effectiveDate}
                        disabled={locked}
                        onChange={(event) => {
                          setEffectiveDate(event.target.value)
                        }}
                      />
                    )}
                  </FormField>

                  <FormField label="Reason code" required hint="The period this growth covers.">
                    {({ id }) => (
                      <Select
                        id={id}
                        options={GROWTH_REASON_OPTIONS.map((option) => ({ ...option }))}
                        value={reasonCode}
                        disabled={locked}
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
                      disabled={locked}
                      onChange={(event) => {
                        setNote(event.target.value)
                      }}
                    />
                  )}
                </FormField>

                {committed === null && outcome.kind !== "unknown" ? (
                  <Button
                    disabled={locked || effectiveDate === "" || futureDated}
                    loading={commit.isPending}
                    onClick={() => {
                      setConfirmingCommit(true)
                    }}
                    trailing
                  >
                    {`Review and commit ${String(plan.targetCount)} adjustment(s)`}
                  </Button>
                ) : null}
              </div>
            </Card>
          </Section>
        </>
      )}

      <ConfirmDialog
        open={confirmingCommit && plan !== null}
        title="Commit this batch?"
        confirmLabel="Commit the batch"
        onConfirm={runCommit}
        onCancel={() => {
          setConfirmingCommit(false)
        }}
      >
        {plan === null ? null : (
          <DataList>
            <DetailRow label="Fund">{fundLabel}</DetailRow>
            <DetailRow label="Positions adjusted" emphasis="lead">
              {String(plan.targetCount)}
            </DetailRow>
            <DetailRow label="Total change">
              <MoneyValue amount={toPaise(plan.totalDeltaPaise)} size="sm" tone="signed" showSign showDecimals />
            </DetailRow>
            <DetailRow label="Effective date">{effectiveDate === "" ? "" : formatDate(effectiveDate)}</DetailRow>
            <DetailRow label="Reason">
              {GROWTH_REASON_OPTIONS.find((option) => option.value === reasonCode)?.label ?? reasonCode}
            </DetailRow>
          </DataList>
        )}
        <p className={PROSE_SM}>
          One growth entry is written for every position above and every investor in the batch is
          notified. A mistake is corrected later with a reversal, not by editing.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmingRestart}
        title="Start over?"
        description="Open one investor's record in this fund first. If an entry from this batch is listed, the batch was committed, and committing again would apply the rate a second time. Starting over discards this preview and cannot be matched to the unconfirmed commit."
        confirmLabel="Start over"
        confirmTone="danger"
        cancelLabel="Keep this commit"
        onConfirm={startOver}
        onCancel={() => {
          setConfirmingRestart(false)
        }}
      />
    </Page>
  )
}

export default CollectiveClientGrowthScreen
