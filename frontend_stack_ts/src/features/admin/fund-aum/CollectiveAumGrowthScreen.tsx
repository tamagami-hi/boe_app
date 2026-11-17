import { useState } from "react"

import { isApiError } from "~/api/errors"
import { commitAdminCollectiveAumGrowth } from "~/api/generated/operations"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { formatDate, indiaToday } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { HeldNotKept } from "~/features/admin/funds/HeldNotKept"
import { useHeldDone } from "~/features/admin/funds/useHeldDone"
import { HeldWriteNotice } from "~/features/admin/shared/HeldWriteNotice"
import { useAdminFundCatalogue } from "~/features/admin/shared/queries"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"

import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { STACK_LG } from "~/ui/recipes/layout"

import { useCollectivePreview, useCommitCollectiveAumGrowth } from "./aumQueries"
import type { CollectiveCommitInput } from "./aumQueries"
import { CollectiveFundChoices, CollectivePlan, fundNamer } from "./CollectivePlan"

type Failure = Readonly<{ isStale: boolean; message: string }>

const UNSENT = "The batch could not be sent. Reload the page and try again."
const SLOT = "fund-aum-collective"

const parseCommitBody = (value: unknown): CollectiveCommitInput | null => {
  const parsed = commitAdminCollectiveAumGrowth.request.body.safeParse(value)
  return parsed.success ? parsed.data : null
}

const PERSIST = { slot: SLOT, parseBody: parseCommitBody } as const

const totalChangeOf = (deltas: readonly string[]): string =>
  deltas.reduce((total, delta) => total + BigInt(delta), 0n).toString()

const commitRejection = (code: string | null, message: string): Failure =>
  code === "STATE_CONFLICT"
    ? {
        isStale: true,
        message:
          "One of these funds changed size after the preview was taken, so the preview is void. Nothing was written. Run a new preview and read it before committing.",
      }
    : { isStale: false, message }

const CollectiveAumGrowthScreen = (): React.ReactElement => {
  const funds = useAdminFundCatalogue()
  const preview = useCollectivePreview()
  const commit = useHeldWrite(useCommitCollectiveAumGrowth(), UNSENT, PERSIST)
  const restored = commit.held

  const [selected, setSelected] = useState<readonly string[]>(() => restored?.fundIds ?? [])
  const [basisPoints, setBasisPoints] = useState(() =>
    restored?.growthBasisPoints === undefined ? "" : String(restored.growthBasisPoints),
  )
  const [asOfDate, setAsOfDate] = useState(() => restored?.asOfDate ?? indiaToday())
  const [reasonCode, setReasonCode] = useState(() => restored?.reasonCode ?? "periodic_growth")
  const [note, setNote] = useState(() => restored?.note ?? "")
  const [previewFailure, setPreviewFailure] = useState<string | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)

  const { outcome } = commit
  const isLocked = commit.held !== null
  const nameFor = fundNamer(funds)
  const rate = Number(basisPoints)
  const invalidRate = !Number.isInteger(rate) || rate === 0
  const failure = outcome.kind === "rejected" ? commitRejection(outcome.code, outcome.message) : null
  const plan = failure?.isStale === true ? null : (preview.data ?? null)
  const trimmedNote = note.trim()
  const commitBody: CollectiveCommitInput | null =
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

  useHeldDone(outcome, () => {
    preview.reset()
    setNote("")
  })

  const clearPreview = (): void => {
    preview.reset()
    setPreviewFailure(null)
    commit.reset()
  }

  const toggle = (fundId: string): void => {
    clearPreview()
    setSelected((current) =>
      current.includes(fundId) ? current.filter((entry) => entry !== fundId) : [...current, fundId],
    )
  }

  const runPreview = (): void => {
    clearPreview()
    preview.mutate(
      { asOfDate, reasonCode: reasonCode.trim(), fundIds: [...selected], growthBasisPoints: rate },
      {
        onError: (error) => {
          setPreviewFailure(
            !isApiError(error)
              ? "We could not build a preview. Nothing has changed."
              : error.code === "STATE_CONFLICT"
                ? "One of these funds has no size recorded, or every change would round to nothing."
                : error.message,
          )
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

      {outcome.kind === "unknown" ? (
        <HeldWriteNotice
          write={commit}
          subject="these fund sizes were updated"
          onReload={funds.refetch}
          reloadLabel="Reload the funds"
        />
      ) : null}
      {outcome.kind === "unknown" && !commit.persisted ? <HeldNotKept /> : null}
      {restored === null || plan !== null ? null : (
        <Card>
          <DataList>
            <DetailRow label="Funds">{restored.fundIds?.map(nameFor).join(", ") ?? ""}</DetailRow>
            <DetailRow label="Rate">{`${String(restored.growthBasisPoints ?? "")} bps`}</DetailRow>
            <DetailRow label="As of">{formatDate(`${restored.asOfDate}T00:00:00Z`)}</DetailRow>
          </DataList>
        </Card>
      )}
      {previewFailure === null ? null : (
        <Alert tone="error" title="No preview">
          {previewFailure}
        </Alert>
      )}
      {failure === null ? null : (
        <Alert tone={failure.isStale ? "warning" : "error"} title="Nothing was written">
          {failure.message}
        </Alert>
      )}
      {outcome.kind === "done" ? (
        <Alert tone="success" title="Batch committed">
          {`${String(outcome.result.targetCount)} fund size(s) updated.`}
        </Alert>
      ) : null}

      <Card elevated>
        <div className={STACK_LG}>
          <FormField label="Funds" required hint="Only funds with a recorded size can be grown.">
            {() => <CollectiveFundChoices funds={funds} selected={selected} isLocked={isLocked} onToggle={toggle} />}
          </FormField>

          <div className={ADMIN_FORM_GRID}>
            <FormField
              label="Rate in basis points"
              required
              hint="250 is +2.5%, applied to each selected fund's current size."
              {...(invalidRate && basisPoints !== "" ? { error: "Enter a whole non-zero number of basis points." } : {})}
            >
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  disabled={isLocked}
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
                  disabled={isLocked}
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
                disabled={isLocked}
                onChange={(event) => {
                  setReasonCode(event.target.value)
                  clearPreview()
                }}
              />
            )}
          </FormField>

          <Button
            tone="secondary"
            disabled={isLocked || selected.length === 0 || invalidRate || reasonCode.trim() === ""}
            loading={preview.isPending}
            onClick={runPreview}
          >
            Preview the batch
          </Button>
        </div>
      </Card>

      {plan === null ? null : (
        <>
          <CollectivePlan plan={plan} basisPoints={basisPoints} asOfDate={asOfDate} nameFor={nameFor} />
          <Section title="Commit the batch">
            <Card>
              <div className={STACK_LG}>
                <FormField label="Note" hint="Internal. Recorded on every snapshot in the batch.">
                  {({ id }) => (
                    <Input
                      id={id}
                      value={note}
                      maxLength={2_000}
                      disabled={isLocked}
                      onChange={(event) => {
                        setNote(event.target.value)
                      }}
                    />
                  )}
                </FormField>
                <Button
                  loading={commit.pending}
                  disabled={isLocked || outcome.kind === "done"}
                  onClick={() => {
                    setIsConfirming(true)
                  }}
                  trailing
                >
                  {`Commit ${String(plan.items.length)} fund size(s)`}
                </Button>
              </div>
            </Card>
          </Section>
        </>
      )}

      <ConfirmDialog
        open={isConfirming && commitBody !== null && plan !== null}
        title="Commit this batch?"
        description="Every fund below gets a new size snapshot, and investors see the new fund sizes. A mistake is corrected with a new entry, never an edit."
        confirmLabel="Commit the batch"
        cancelLabel="Cancel"
        onConfirm={() => {
          setIsConfirming(false)
          if (commitBody !== null) commit.submit(commitBody)
        }}
        onCancel={() => {
          setIsConfirming(false)
        }}
      >
        {plan === null ? null : (
          <DataList>
            <DetailRow label="Funds">{plan.items.map((item) => nameFor(item.fundId)).join(", ")}</DetailRow>
            <DetailRow label="Rate">{`${basisPoints} bps`}</DetailRow>
            <DetailRow label="Total change" emphasis="lead">
              <MoneyValue
                amount={toPaise(totalChangeOf(plan.items.map((item) => item.deltaPaise)))}
                size="sm"
                tone="signed"
                showSign
                showDecimals
              />
            </DetailRow>
            <DetailRow label="As of">{formatDate(`${asOfDate}T00:00:00Z`)}</DetailRow>
            <DetailRow label="Reason code">{reasonCode.trim()}</DetailRow>
          </DataList>
        )}
      </ConfirmDialog>
    </Page>
  )
}

export default CollectiveAumGrowthScreen
