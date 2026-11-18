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
import { useFundClientPositions } from "./growthQueries"
import {
  parseInvestmentGrowthCommit,
  skipsOf,
  useClientInvestmentsMany,
  useCommitInvestmentGrowth,
  usePreviewInvestmentGrowth,
  useRefreshClientInvestments,
} from "./investmentGrowthApi"
import { LEGACY_SHEET_SLOT, useLegacyCollectiveHold } from "./LegacyGrowthHold"
import { ListSkeleton } from "./ListSkeleton"
import { ValueUpdatePreview, type LeftOutRow } from "./ValueUpdatePreview"
import { FundRatePrefill, ValueUpdateSheetTable } from "./ValueUpdateSheetTable"
import {
  MAX_SHEET_CHANGES,
  commitItemsOf,
  overrideRow,
  planSheet,
  prefillFromRate,
  previewMatchesSheet,
  sheetCommitBody,
  sheetRowsFrom,
  skippedChangesOf,
} from "./valueUpdateSheet"
import type { SheetChange, SheetPosition, SheetRow } from "./valueUpdateSheet"

const VALUE_UPDATE_REASON = "monthly"

const STALE_SUFFIX = "Reload the sheet, check the numbers and preview again."

const flaggedNotice = (count: number): string =>
  `${String(count)} client(s) in this preview must have their investments sorted first: categorise their recordings and confirm any earlier growth split in the Ledger tab. Their rows were taken out of the sheet. Preview again to continue without them.`

const NO_FLAGS: ReadonlySet<string> = new Set()

type Previewed = Readonly<{
  fundId: string
  items: readonly SheetChange[]
  snapshot: readonly SheetRow[]
}>

const SHEET_DESCRIPTION =
  "Pick a fund and type each investment's gain since it was invested, one row per client per investment. A fund rate can fill every row first, and any row can then be typed over. Blank rows are skipped, and the whole sheet is written as one batch or not at all."

const RESTART_DESCRIPTION =
  "Open one client's record in this fund first. If an update from this batch is listed, the batch was written, and writing again would apply the change twice. Starting over discards this preview."

const NO_POSITIONS: readonly SheetPosition[] = []

const INVESTMENTS_FAILED =
  "The investments of one or more clients in this fund could not be read, so the sheet cannot be shown. Nothing was written."

const UNSENT = "This batch could not be sent. Reload the page and try again."

export const VALUE_UPDATE_SLOT = "investment-growth-sheet"

const skippedRowsOf = (rows: readonly SheetRow[], skipped: readonly SheetChange[]): LeftOutRow[] => {
  const byKey = new Map(rows.map((row) => [row.rowKey, row]))
  return skipped.map((change) => {
    const row = byKey.get(change.rowKey)
    return { key: change.rowKey, client: row?.fullName ?? "Name not available", investment: row?.label ?? "" }
  })
}

const describePreviewFailure = (error: unknown): string => {
  if (!isApiError(error)) return "We could not build a preview. A preview never writes anything."
  return error.code === "STATE_CONFLICT"
    ? "No position in this fund can take a value update."
    : error.message
}

const ValueUpdateSheetScreen = (): React.ReactElement => {
  const funds = useFundNames()
  const preview = usePreviewInvestmentGrowth()
  const commitMutation = useCommitInvestmentGrowth()
  const commit = useHeldWrite(commitMutation, UNSENT, {
    slot: VALUE_UPDATE_SLOT,
    parseBody: parseInvestmentGrowthCommit,
    retention: "ordinary",
  })
  const held = commit.held?.body ?? null
  const legacy = useLegacyCollectiveHold(LEGACY_SHEET_SLOT)
  const refreshInvestments = useRefreshClientInvestments()
  const [fundId, setFundId] = useState(() => held?.fundId ?? "")
  const positions = useFundClientPositions(fundId)
  const [inputs, setInputs] = useState<Readonly<Record<string, string>>>({})
  const [previewed, setPreviewed] = useState<Previewed | null>(null)
  const [previewFailure, setPreviewFailure] = useState<string | null>(null)
  const [effectiveDate, setEffectiveDate] = useState(() => held?.effectiveDate ?? indiaToday())
  const [note, setNote] = useState(() => held?.note ?? "")
  const [confirmingCommit, setConfirmingCommit] = useState(false)
  const [confirmingRestart, setConfirmingRestart] = useState(false)

  const [fundRate, setFundRate] = useState("")
  const [flaggedByServer, setFlaggedByServer] = useState<ReadonlySet<string>>(NO_FLAGS)
  const [flaggedCount, setFlaggedCount] = useState(0)
  const positionItems = positions.data?.items ?? NO_POSITIONS
  const userIds = useMemo(() => positionItems.map((position) => position.userId), [positionItems])
  const investments = useClientInvestmentsMany(userIds)
  const rows = useMemo(
    () => (investments.pending || investments.failed ? [] : sheetRowsFrom(positionItems, investments.byUserId, fundId, flaggedByServer)),
    [positionItems, investments.pending, investments.failed, investments.byUserId, fundId, flaggedByServer],
  )
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
  const locked = commit.pending || commit.held !== null || commit.unreadable || committed !== null || legacy.locked
  const staleBasis = commit.outcome.kind === "rejected" && commit.outcome.code === "STATE_CONFLICT"
  const result = staleBasis || previewed === null ? null : (preview.data ?? null)
  const matches =
    result !== null &&
    previewed !== null &&
    previewMatchesSheet(previewed.snapshot, previewed.items, result.entries, skipsOf(result.skipped))
  const tooMany = plan.changes.length > MAX_SHEET_CHANGES
  const canPreview =
    !locked && result === null && plan.changes.length > 0 && plan.invalidCount === 0 && !tooMany
  const today = indiaToday()
  const trimmedNote = note.trim()
  const commitBody =
    result === null || previewed === null || !matches
      ? null
      : sheetCommitBody(previewed.fundId, previewed.items, {
          basisHash: result.basisHash,
          effectiveDate,
          reasonCode: VALUE_UPDATE_REASON,
          note: trimmedNote,
        })
  const heldCount = held?.items?.length ?? 0

  const clearPreview = (): void => {
    preview.reset()
    commit.reset()
    setPreviewed(null)
    setPreviewFailure(null)
  }

  const chooseFund = (next: string): void => {
    setFundId(next)
    setInputs({})
    setFundRate("")
    setFlaggedByServer(NO_FLAGS)
    setFlaggedCount(0)
    clearPreview()
  }

  const typeGain = (rowKey: string, text: string): void => {
    setInputs((current) => overrideRow(current, rowKey, text))
    if (previewed !== null || previewFailure !== null) clearPreview()
  }

  const fillFromRate = (basisPoints: number): void => {
    setInputs(prefillFromRate(rows, basisPoints))
    if (previewed !== null || previewFailure !== null) clearPreview()
  }

  const runPreview = (): void => {
    clearPreview()
    setFlaggedCount(0)
    const snapshot = rows
    const items = plan.changes
    setPreviewed({ fundId, items, snapshot })
    preview.mutate(
      { fundId, items: commitItemsOf(items) },
      {
        onSuccess: (data) => {
          const sent = new Set(items.map((item) => item.userId))
          const flagged = data.skipped
            .filter((skip) => skip.reason === "categorise_first" && sent.has(skip.userId))
            .map((skip) => skip.userId)
          if (flagged.length === 0) return
          setFlaggedByServer((current) => new Set([...current, ...flagged]))
          setFlaggedCount(new Set(flagged).size)
          preview.reset()
          setPreviewed(null)
        },
        onError: (error) => {
          setPreviewFailure(describePreviewFailure(error))
        },
      },
    )
  }

  const reloadSheet = (): void => {
    clearPreview()
    setFlaggedByServer(NO_FLAGS)
    setFlaggedCount(0)
    void positions.refetch()
    void refreshInvestments()
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

      {legacy.notice}

      {flaggedCount === 0 ? null : (
        <Alert tone="warning" title="Categorise first">
          {flaggedNotice(flaggedCount)}
        </Alert>
      )}

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
          {staleBasis ? `${commit.outcome.message} ${STALE_SUFFIX}` : commit.outcome.message}
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
              : ` Held: ${funds.nameOf(held.fundId)}, ${String(heldCount)} investment(s), dated ${formatDate(held.effectiveDate)}.`
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
          {`${String(committed.targetCount)} client(s) updated, each with one value update made of its investments' changes. Each was told in the app, and active clients by email.`}
        </Alert>
      )}

      <Card elevated>
        <CatalogueFundPicker value={fundId} disabled={locked} onChange={chooseFund} />
      </Card>

      {fundId === "" ? null : (
        <Section
          title="Clients in this fund"
          description="Each client's investments in this fund, with the amount invested in each and the fund value now."
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
            {() => investments.failed ? (
              <Alert tone="error" title="Sheet not loaded" action={reloadAction}>
                {INVESTMENTS_FAILED}
              </Alert>
            ) : investments.pending ? (
              <ListSkeleton />
            ) : (
              <div className={STACK_LG}>
                <FundRatePrefill value={fundRate} disabled={locked} onChange={setFundRate} onFill={fillFromRate} />
                <ValueUpdateSheetTable
                  rows={rows}
                  inputs={inputs}
                  plan={plan}
                  locked={locked}
                  onInput={typeGain}
                />
                <p className={PROSE_SM}>
                  {tooMany
                    ? `One batch can hold at most ${String(MAX_SHEET_CHANGES)} changes. Split the sheet.`
                    : `${String(plan.changes.length)} investment(s) to preview. ${String(
                        plan.invalidCount,
                      )} row(s) need attention. ${String(plan.skippedRowCount)} row(s) of ${String(
                        plan.skippedClientCount,
                      )} client(s) read Categorise first and are left out of this batch.`}
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
          entries={result.entries}
          skippedClientCount={plan.skippedClientCount}
          leftOut={skippedRowsOf(previewed.snapshot, skippedChangesOf(previewed.items, skipsOf(result.skipped)))}
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
