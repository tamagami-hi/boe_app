import { useMemo, useState } from "react"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { useIdempotencyKey } from "~/api/idempotency"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { useAdminFundCatalogue } from "~/features/admin/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

import { CatalogueFundPicker } from "./CatalogueFundPicker"
import {
  useCommitCollectiveClientGrowth,
  useFundClientPositions,
  usePreviewCollectiveClientGrowth,
} from "./growthQueries"
import type { CollectiveGrowthCommitInput } from "./growthQueries"
import { indiaToday } from "./indiaToday"
import { ListSkeleton } from "./ListSkeleton"
import { ValueUpdatePreview } from "./ValueUpdatePreview"
import { ValueUpdateSheetTable } from "./ValueUpdateSheetTable"
import { MAX_SHEET_CHANGES, planSheet, previewMatchesSheet } from "./valueUpdateSheet"
import type { SheetChange, SheetPosition } from "./valueUpdateSheet"

const VALUE_UPDATE_REASON = "monthly"

const STALE_MESSAGE =
  "A value in this fund changed after the preview, so nothing was written. Reload the sheet, check the numbers and preview again."

type CommitOutcome =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "rejected"; message: string; stale: boolean }>
  | Readonly<{ kind: "unknown" }>

type Previewed = Readonly<{
  fundId: string
  items: readonly SheetChange[]
  snapshot: readonly SheetPosition[]
}>

const SHEET_DESCRIPTION =
  "Pick a fund and type each client's gain since they invested. The change since the last update is worked out for you, in exact paise. Blank or unchanged rows are skipped, and the whole sheet is written as one batch or not at all."

const RESTART_DESCRIPTION =
  "Open one client's record in this fund first. If an update from this batch is listed, the batch was written, and writing again would apply the change twice. Starting over discards this preview."

const IDLE: CommitOutcome = { kind: "idle" }
const NO_POSITIONS: readonly SheetPosition[] = []

const describeCommitRejection = (error: unknown): CommitOutcome => {
  if (isUnknownWriteOutcome(error)) return { kind: "unknown" }
  if (isApiError(error) && error.code === "STATE_CONFLICT") {
    return { kind: "rejected", message: STALE_MESSAGE, stale: true }
  }
  return {
    kind: "rejected",
    message: isApiError(error)
      ? error.message
      : "This batch could not be sent. Reload the page and try again.",
    stale: false,
  }
}

const describePreviewFailure = (error: unknown): string => {
  if (!isApiError(error)) return "We could not build a preview. A preview never writes anything."
  return error.code === "STATE_CONFLICT"
    ? "No position in this fund can take a value update."
    : error.message
}

const ValueUpdateSheetScreen = (): React.ReactElement => {
  const funds = useAdminFundCatalogue()
  const preview = usePreviewCollectiveClientGrowth()
  const commit = useCommitCollectiveClientGrowth()
  const [fundId, setFundId] = useState("")
  const positions = useFundClientPositions(fundId)
  const [inputs, setInputs] = useState<Readonly<Record<string, string>>>({})
  const [previewed, setPreviewed] = useState<Previewed | null>(null)
  const [previewFailure, setPreviewFailure] = useState<string | null>(null)
  const [effectiveDate, setEffectiveDate] = useState(indiaToday)
  const [note, setNote] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [outcome, setOutcome] = useState<CommitOutcome>(IDLE)
  const [held, setHeld] = useState<CollectiveGrowthCommitInput | null>(null)
  const [confirmingCommit, setConfirmingCommit] = useState(false)
  const [confirmingRestart, setConfirmingRestart] = useState(false)

  const rows = positions.data?.items ?? NO_POSITIONS
  const plan = useMemo(() => planSheet(rows, inputs), [rows, inputs])
  const names = useMemo(
    () => new Map((previewed?.snapshot ?? rows).map((row) => [row.userId, row.fullName])),
    [previewed, rows],
  )
  const fund = (funds.data?.items ?? []).find((entry) => entry.id === fundId)
  const fundLabel = fund?.name ?? fund?.slug ?? fundId
  const committed = commit.data ?? null
  const locked = commit.isPending || outcome.kind === "unknown" || committed !== null
  const staleBasis = outcome.kind === "rejected" && outcome.stale
  const result = staleBasis || previewed === null ? null : (preview.data ?? null)
  const matches =
    result !== null &&
    previewed !== null &&
    previewMatchesSheet(previewed.snapshot, previewed.items, result.targets)
  const tooMany = plan.changes.length > MAX_SHEET_CHANGES
  const canPreview =
    !locked && result === null && plan.changes.length > 0 && plan.invalidCount === 0 && !tooMany
  const today = indiaToday()
  const trimmedNote = note.trim()
  const commitBody =
    result === null || previewed === null || !matches
      ? null
      : {
          fundId: previewed.fundId,
          items: previewed.items.map((item) => ({ ...item })),
          basisHash: result.basisHash,
          effectiveDate,
          reasonCode: VALUE_UPDATE_REASON,
          ...(trimmedNote === "" ? {} : { note: trimmedNote }),
        }
  const idempotencyKey = useIdempotencyKey({ body: commitBody, attempt })

  const clearPreview = (): void => {
    preview.reset()
    commit.reset()
    setPreviewed(null)
    setPreviewFailure(null)
    setOutcome(IDLE)
    setHeld(null)
  }

  const chooseFund = (next: string): void => {
    setFundId(next)
    setInputs({})
    clearPreview()
  }

  const typeGain = (userId: string, text: string): void => {
    setInputs((current) => ({ ...current, [userId]: text }))
    if (previewed !== null || previewFailure !== null) clearPreview()
  }

  const runPreview = (): void => {
    clearPreview()
    const snapshot = rows
    const items = plan.changes
    setPreviewed({ fundId, items, snapshot })
    preview.mutate(
      { fundId, items: items.map((item) => ({ ...item })) },
      {
        onError: (error) => {
          setPreviewFailure(describePreviewFailure(error))
        },
      },
    )
  }

  const reloadSheet = (): void => {
    clearPreview()
    void positions.refetch()
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
    if (commitBody !== null) sendCommit({ idempotencyKey, body: commitBody })
  }

  const checkAgain = (): void => {
    if (held !== null) sendCommit(held)
  }

  const askRestart = (): void => {
    setConfirmingRestart(true)
  }

  const startOver = (): void => {
    setConfirmingRestart(false)
    setAttempt((current) => current + 1)
    clearPreview()
  }

  const startNextSheet = (): void => {
    setInputs({})
    setNote("")
    startOver()
  }

  const reloadAction = (
    <Button size="sm" onClick={reloadSheet}>
      Reload the sheet
    </Button>
  )

  return (
    <Page width="wide">
      <PageHeader
        title="Monthly value update"
        description={SHEET_DESCRIPTION}
      />

      {previewFailure === null ? null : (
        <Alert tone="error" title="No preview">
          {previewFailure}
        </Alert>
      )}

      {outcome.kind === "rejected" ? (
        <Alert
          tone={outcome.stale ? "warning" : "error"}
          title="Nothing was written"
          {...(outcome.stale ? { action: reloadAction } : {})}
        >
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
              <Button size="sm" tone="secondary" disabled={commit.isPending} onClick={askRestart}>
                Start over
              </Button>
            </span>
          }
        >
          The reply did not arrive, so it is not known whether this batch was written. Check again sends
          the same request under the same key, and it can only ever be written once.
        </Alert>
      ) : null}

      {committed === null ? null : (
        <Alert
          tone="success"
          title="Value update written"
          action={
            <Button size="sm" tone="secondary" onClick={startNextSheet}>
              Start the next sheet
            </Button>
          }
        >
          {`${String(committed.targetCount)} client(s) updated. Each of them has been notified.`}
        </Alert>
      )}

      <Card elevated>
        <CatalogueFundPicker value={fundId} disabled={locked} onChange={chooseFund} />
      </Card>

      {fundId === "" ? null : (
        <Section
          title="Clients in this fund"
          description="Invested, current value and gain are read from the ledger now."
        >
          <AsyncBoundary
            query={positions}
            skeleton={<ListSkeleton />}
            isEmpty={(data) => data.items.length === 0}
            empty={
              <EmptyState
                title="No client holds this fund"
                description="Record an investment for a client first."
              />
            }
          >
            {(data) => (
              <div className={STACK_LG}>
                <ValueUpdateSheetTable
                  positions={data.items}
                  inputs={inputs}
                  plan={plan}
                  locked={locked}
                  onInput={typeGain}
                />
                <p className={PROSE_SM}>
                  {tooMany
                    ? `One batch can hold at most ${String(MAX_SHEET_CHANGES)} changes. Split the sheet.`
                    : `${String(plan.changes.length)} change(s) to preview. ${String(
                        plan.invalidCount,
                      )} row(s) need attention.`}
                </p>
                <Button
                  tone="secondary"
                  disabled={!canPreview}
                  loading={preview.isPending}
                  onClick={runPreview}
                >
                  Preview the changes
                </Button>
              </div>
            )}
          </AsyncBoundary>
        </Section>
      )}

      {result === null ? null : matches ? (
        <ValueUpdatePreview
          targets={result.targets}
          totalDeltaPaise={result.totalDeltaPaise}
          nameOf={(userId) => names.get(userId) ?? userId}
          effectiveDate={effectiveDate}
          today={today}
          note={note}
          locked={locked}
          showCommit={committed === null && outcome.kind !== "unknown"}
          committing={commit.isPending}
          onEffectiveDate={setEffectiveDate}
          onNote={setNote}
          onReview={() => {
            setConfirmingCommit(true)
          }}
        />
      ) : (
        <Alert tone="warning" title="The sheet is out of date" action={reloadAction}>
          The server&apos;s numbers no longer match the ones on this sheet, so nothing can be committed
          from it. Reload, check the gains and preview again.
        </Alert>
      )}

      <ConfirmDialog
        open={confirmingCommit && commitBody !== null}
        title="Write this value update?"
        confirmLabel="Write the value update"
        onConfirm={runCommit}
        onCancel={() => {
          setConfirmingCommit(false)
        }}
      >
        {result === null ? null : (
          <DataList>
            <DetailRow label="Fund">{fundLabel}</DetailRow>
            <DetailRow label="Clients updated" emphasis="lead">
              {String(result.targetCount)}
            </DetailRow>
            <DetailRow label="Total change">
              <MoneyValue
                amount={toPaise(result.totalDeltaPaise)}
                size="sm"
                tone="signed"
                showSign
                showDecimals
              />
            </DetailRow>
            <DetailRow label="Effective date">
              {effectiveDate === "" ? "" : formatDate(effectiveDate)}
            </DetailRow>
            <DetailRow label="Reason">Monthly</DetailRow>
          </DataList>
        )}
        <p className={PROSE_SM}>
          Each client in the batch is notified that their fund value was updated.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmingRestart}
        title="Start over?"
        description={RESTART_DESCRIPTION}
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

export default ValueUpdateSheetScreen
