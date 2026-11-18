import { useMemo, useState } from "react"

import { isApiError } from "~/api/errors"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { formatDate, indiaToday } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { useFundNames } from "~/features/admin/shared/fundNames"
import { HeldWriteNotice, UnsavedHoldNotice, isUnsavedHold } from "~/features/admin/shared/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { useUnloadGuard } from "~/features/admin/shared/useUnloadGuard"
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
import { parseCollectiveCommit } from "./heldBodies"
import { ListSkeleton } from "./ListSkeleton"
import { ValueUpdatePreview } from "./ValueUpdatePreview"
import { ValueUpdateSheetTable } from "./ValueUpdateSheetTable"
import { MAX_SHEET_CHANGES, planSheet, previewMatchesSheet } from "./valueUpdateSheet"
import type { SheetChange, SheetPosition } from "./valueUpdateSheet"

const VALUE_UPDATE_REASON = "monthly"

const STALE_MESSAGE =
  "A value in this fund changed after the preview, so nothing was written. Reload the sheet, check the numbers and preview again."

type Previewed = Readonly<{
  fundId: string
  items: readonly SheetChange[]
  snapshot: readonly SheetPosition[]
}>

const SHEET_DESCRIPTION =
  "Pick a fund and type each client's gain since they invested. The change since the last update is worked out for you, in exact paise. Blank or unchanged rows are skipped, and the whole sheet is written as one batch or not at all."

const RESTART_DESCRIPTION =
  "Open one client's record in this fund first. If an update from this batch is listed, the batch was written, and writing again would apply the change twice. Starting over discards this preview."

const NO_POSITIONS: readonly SheetPosition[] = []

const UNSENT = "This batch could not be sent. Reload the page and try again."

export const VALUE_UPDATE_SLOT = "value-update"

const describePreviewFailure = (error: unknown): string => {
  if (!isApiError(error)) return "We could not build a preview. A preview never writes anything."
  return error.code === "STATE_CONFLICT"
    ? "No position in this fund can take a value update."
    : error.message
}

const ValueUpdateSheetScreen = (): React.ReactElement => {
  const funds = useFundNames()
  const preview = usePreviewCollectiveClientGrowth()
  const commitMutation = useCommitCollectiveClientGrowth()
  const commit = useHeldWrite(commitMutation, UNSENT, {
    slot: VALUE_UPDATE_SLOT,
    parseBody: parseCollectiveCommit,
    retention: "ordinary",
  })
  const held = commit.held?.body ?? null
  const [fundId, setFundId] = useState(() => held?.fundId ?? "")
  const positions = useFundClientPositions(fundId)
  const [inputs, setInputs] = useState<Readonly<Record<string, string>>>({})
  const [previewed, setPreviewed] = useState<Previewed | null>(null)
  const [previewFailure, setPreviewFailure] = useState<string | null>(null)
  const [effectiveDate, setEffectiveDate] = useState(() => held?.effectiveDate ?? indiaToday())
  const [note, setNote] = useState(() => held?.note ?? "")
  const [confirmingCommit, setConfirmingCommit] = useState(false)
  const [confirmingRestart, setConfirmingRestart] = useState(false)

  const rows = positions.data?.items ?? NO_POSITIONS
  const plan = useMemo(() => planSheet(rows, inputs), [rows, inputs])
  const names = useMemo(
    () => new Map((previewed?.snapshot ?? rows).map((row) => [row.userId, row.fullName])),
    [previewed, rows],
  )
  const fundLabel = funds.nameOf(fundId)
  const committed = commitMutation.data ?? null
  const unknown = commit.outcome.kind === "unknown"
  useUnloadGuard(isUnsavedHold(commit))
  const keptAcrossPages = commit.persisted ? " also after leaving this page," : ""
  const locked = commit.pending || commit.held !== null || commit.unreadable || committed !== null
  const staleBasis = commit.outcome.kind === "rejected" && commit.outcome.code === "STATE_CONFLICT"
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

  const clearPreview = (): void => {
    preview.reset()
    commit.reset()
    setPreviewed(null)
    setPreviewFailure(null)
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

  const runCommit = (): void => {
    setConfirmingCommit(false)
    if (commitBody !== null) commit.submit({ body: commitBody })
  }

  const askRestart = (): void => {
    setConfirmingRestart(true)
  }

  const startOver = (): void => {
    setConfirmingRestart(false)
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

      {commit.outcome.kind === "rejected" ? (
        <Alert
          tone={staleBasis ? "warning" : "error"}
          title="Nothing was written"
          {...(staleBasis ? { action: reloadAction } : {})}
        >
          {staleBasis ? STALE_MESSAGE : commit.outcome.message}
        </Alert>
      ) : null}

      {commit.outcome.kind === "rejected" || (unknown && !commit.expired) ? null : (
        <HeldWriteNotice
          write={{
            outcome: commit.outcome,
            pending: commit.pending,
            checkAgain: commit.checkAgain,
            unreadable: commit.unreadable,
            expired: commit.expired,
          }}
          subject="this batch was written"
          reloadLabel="Start over"
          onReload={askRestart}
        />
      )}

      <UnsavedHoldNotice write={commit} />

      {unknown && !commit.expired ? (
        <Alert
          tone="warning"
          title="Not confirmed"
          action={
            <span className={ACTION_ROW}>
              <Button size="sm" loading={commit.pending} onClick={commit.checkAgain}>
                Check again
              </Button>
              <Button size="sm" tone="secondary" disabled={commit.pending} onClick={askRestart}>
                Start over
              </Button>
            </span>
          }
        >
          {`The reply did not arrive, so it is not known whether this batch was written. Check again sends the same request under the same key,${keptAcrossPages} and it can only ever be written once.${
            held === null
              ? ""
              : ` Held: ${funds.nameOf(held.fundId)}, ${String(held.items?.length ?? 0)} change(s), dated ${formatDate(held.effectiveDate)}.`
          }`}
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
          {`${String(committed.targetCount)} client(s) updated. Each was told in the app, and active clients by email.`}
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
          nameOf={(userId) => names.get(userId) ?? "Name not available"}
          effectiveDate={effectiveDate}
          today={today}
          note={note}
          locked={locked}
          showCommit={committed === null && !unknown}
          committing={commit.pending}
          onEffectiveDate={setEffectiveDate}
          onNote={setNote}
          onReview={() => {
            setConfirmingCommit(true)
          }}
        />
      ) : (
        <Alert tone="warning" title="The sheet is out of date" action={reloadAction}>
          The saved figures no longer match the ones on this sheet, so nothing can be committed
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
          Each client in the batch is told in the app that their fund value was updated. Active clients also get an
          email with the change and their new value.
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
