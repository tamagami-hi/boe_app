import { useEffect, useMemo, useState } from "react"

import { indiaToday } from "~/domain/dates"
import { applyBasisPoints, toPaise } from "~/domain/money"
import { useAdminInvestorPositions } from "~/features/admin/shared/adminQueries"
import { useFundNames } from "~/features/admin/shared/fundNames"
import { HeldWriteNotice, UnsavedHoldNotice, isUnsavedHold } from "~/features/admin/shared/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { useUnloadGuard } from "~/features/admin/shared/useUnloadGuard"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { RadioGroup } from "~/ui/primitives/Toggle"
import { Select } from "~/ui/primitives/Select"
import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { ACTION_ROW, STACK_LG, STACK_SM } from "~/ui/recipes/layout"

import { GrowthAmountFields, type Direction } from "./GrowthAmountFields"
import { GrowthConfirmDialogs } from "./GrowthConfirmDialogs"
import { GrowthReceipt } from "./GrowthReceipt"
import { useIndividualClientGrowth, type IndividualGrowthHold } from "./growthQueries"
import { parseIndividualGrowth } from "./heldBodies"
import { DEFAULT_GROWTH_REASON, GROWTH_REASON_OPTIONS } from "./growthReasons"
import { paiseToRupeeText, parsePositiveRupees } from "./rupeeAmount"

type Mode = "rate" | "amount"

const MIN_BASIS_POINTS = -2_000
const MAX_BASIS_POINTS = 2_000

const UNSENT = "This adjustment could not be sent. Reload the page and try again."

export const growthSlot = (userId: string): string => `growth:${userId}`

export const formatRate = (basisPoints: number): string => `${basisPoints > 0 ? "+" : ""}${String(basisPoints / 100)}%`

const describeRejection = (code: string | null, message: string): string =>
  code === "RESOURCE_NOT_FOUND" ? "That investor has no contribution in that fund, so there is nothing to adjust." : message

type Draft = Readonly<{
  mode: Mode
  basisPoints: string
  direction: Direction
  rupees: string
  effectiveDate: string
  reasonCode: string
  note: string
}>

const draftOf = (held: IndividualGrowthHold | null, today: string): Draft => {
  const body = held?.body
  const growthPaise = body?.growthPaise
  return {
    mode: growthPaise === undefined ? "rate" : "amount",
    basisPoints: typeof body?.growthBasisPoints === "number" ? String(body.growthBasisPoints) : "",
    direction: growthPaise?.startsWith("-") === true ? "decrease" : "increase",
    rupees: growthPaise === undefined ? "" : paiseToRupeeText(growthPaise.replace(/^-/u, "")),
    effectiveDate: body?.effectiveDate ?? today,
    reasonCode: body?.reasonCode ?? DEFAULT_GROWTH_REASON,
    note: body?.note ?? "",
  }
}

export type IndividualGrowthFormProps = Readonly<{
  userId: string
  investorLabel: string
  initialFundId: string
  renderPicker: (disabled: boolean) => React.ReactNode
  onFundChange: (fundId: string) => void
  onInvestorLock?: (isLocked: boolean) => void
}>

export const IndividualGrowthForm = ({
  userId,
  investorLabel,
  initialFundId,
  renderPicker,
  onFundChange,
  onInvestorLock,
}: IndividualGrowthFormProps): React.ReactElement => {
  const funds = useFundNames()
  const mutation = useIndividualClientGrowth()
  const write = useHeldWrite(mutation, UNSENT, {
    slot: growthSlot(userId),
    parseBody: parseIndividualGrowth,
    retention: "ordinary",
  })
  const today = indiaToday()
  const [draft, setDraft] = useState<Draft>(() => draftOf(write.held, today))
  const [fundId, setFundId] = useState(() => write.held?.body.fundId ?? initialFundId)
  const [asking, setAsking] = useState<"append" | "restart" | null>(null)
  const positions = useAdminInvestorPositions(userId)

  const edit = (patch: Partial<Draft>): void => {
    setDraft((current) => ({ ...current, ...patch }))
  }

  const recorded = mutation.data
  const unknown = write.outcome.kind === "unknown"
  const locked = write.held !== null || write.pending || write.unreadable || recorded !== undefined
  const positionsFailed = userId !== "" && positions.data === undefined && positions.error != null
  const positionItems = positions.data?.items ?? []
  const selectedPosition = positionItems.find((position) => position.fundId === fundId) ?? null
  const fundPrompt =
    userId === ""
      ? "Choose an investor first"
      : positionsFailed
        ? "This investor's funds could not be loaded"
        : positions.data === undefined
          ? "Loading this investor's funds"
          : positionItems.length === 0
            ? "This investor holds no fund"
            : "Choose a fund"

  const rate = Number(draft.basisPoints)
  const rateInBand = Number.isInteger(rate) && rate !== 0 && rate >= MIN_BASIS_POINTS && rate <= MAX_BASIS_POINTS
  const invalidRate = draft.mode === "rate" && !rateInBand
  const magnitudePaise = parsePositiveRupees(draft.rupees)
  const signedPaise = magnitudePaise === null ? null : draft.direction === "decrease" ? `-${magnitudePaise}` : magnitudePaise
  const invalidAmount = draft.mode === "amount" && signedPaise === null
  const futureDated = draft.effectiveDate > today
  const incomplete =
    userId === "" ||
    selectedPosition === null ||
    !funds.ready ||
    draft.reasonCode === "" ||
    draft.effectiveDate === "" ||
    futureDated ||
    invalidRate ||
    invalidAmount

  const adjustment = useMemo(() => {
    if (selectedPosition === null) return null
    const current = BigInt(selectedPosition.currentValuePaise)
    if (draft.mode === "amount") {
      if (signedPaise === null) return null
      const delta = BigInt(signedPaise)
      return { delta, projected: current + delta }
    }
    if (invalidRate) return null
    const delta = BigInt(applyBasisPoints(toPaise(selectedPosition.principalPaise), rate))
    return { delta, projected: current + delta }
  }, [selectedPosition, draft.mode, signedPaise, invalidRate, rate])

  const unsaved = isUnsavedHold(write)
  const isInvestorLocked = write.pending || unsaved
  useUnloadGuard(unsaved)

  useEffect(() => {
    onInvestorLock?.(isInvestorLocked)
    return () => {
      onInvestorLock?.(false)
    }
  }, [isInvestorLocked, onInvestorLock])

  const append = (): void => {
    setAsking(null)
    const trimmedNote = draft.note.trim()
    write.submit({
      body: {
        userId,
        fundId,
        effectiveDate: draft.effectiveDate,
        reasonCode: draft.reasonCode,
        ...(trimmedNote === "" ? {} : { note: trimmedNote }),
        ...(draft.mode === "rate" ? { growthBasisPoints: rate } : { growthPaise: signedPaise ?? "" }),
      },
    })
  }

  const startNewAttempt = (): void => {
    setAsking(null)
    write.reset()
  }

  const adjustAgain = (): void => {
    edit({ basisPoints: "", rupees: "", note: "" })
    write.reset()
  }

  return (
    <>
      {write.outcome.kind === "rejected" ? (
        <Alert tone="error" title="Not recorded">
          {describeRejection(write.outcome.code, write.outcome.message)}
        </Alert>
      ) : null}

      {unknown && !write.expired ? (
        <Alert
          tone="warning"
          title="Not confirmed"
          action={
            <span className={ACTION_ROW}>
              <Button size="sm" loading={write.pending} onClick={write.checkAgain}>
                Check again
              </Button>
              <Button
                size="sm"
                tone="secondary"
                disabled={write.pending}
                onClick={() => {
                  setAsking("restart")
                }}
              >
                Start a new attempt
              </Button>
            </span>
          }
        >
          The reply did not arrive, so it is not known whether this adjustment was appended. The form is held on this
          exact request. Check again sends it once more under the same key, and the same request can only ever be
          appended once. It may also already appear in this investor&apos;s ledger entries.
        </Alert>
      ) : write.outcome.kind === "rejected" ? null : (
        <HeldWriteNotice
          write={{
            outcome: write.outcome,
            pending: write.pending,
            checkAgain: write.checkAgain,
            unreadable: write.unreadable,
            expired: write.expired,
          }}
          subject="this adjustment was appended"
          reloadLabel="Start a new attempt"
          onReload={() => {
            setAsking("restart")
          }}
        />
      )}
      <UnsavedHoldNotice write={write} />

      {recorded === undefined ? null : (
        <Alert
          tone="success"
          title="Adjustment recorded"
          action={
            <Button size="sm" tone="secondary" onClick={adjustAgain}>
              Adjust again
            </Button>
          }
        >
          The ledger entry is written. The investor was told in the app, and by email if their account is active. The
          form is held so the same adjustment cannot
          be appended twice by mistake.
        </Alert>
      )}

      {funds.notice}

      <Card elevated>
        <div className={STACK_LG}>
          <FormField label="How are you adjusting it">
            {() => (
              <RadioGroup<Mode>
                legend="Adjustment mode"
                value={draft.mode}
                onChange={(next) => {
                  if (!locked) edit({ mode: next })
                }}
                options={[
                  {
                    value: "rate",
                    label: "By a rate",
                    hint: "A percentage of the amount invested, in basis points. 250 is +2.5%. The rate never applies to the current value, so repeated adjustments do not compound.",
                  },
                  {
                    value: "amount",
                    label: "By an exact amount",
                    hint: "An amount in rupees that raises or lowers the value. Use this for a correction where the number is already known.",
                  },
                ]}
              />
            )}
          </FormField>

          {renderPicker(isInvestorLocked)}

          <div className={STACK_SM}>
            <FormField
              label="Fund"
              required
              hint="Only the funds this investor has actually invested in."
              error={positionsFailed ? "The list of this investor's funds could not be loaded." : undefined}
            >
              {({ id, invalid }) => (
                <Select
                  id={id}
                  options={[
                    { value: "", label: fundPrompt },
                    ...positionItems.map((position) => ({ value: position.fundId, label: funds.nameOf(position.fundId) })),
                  ]}
                  value={fundId}
                  invalid={invalid}
                  disabled={locked || positionItems.length === 0 || !funds.ready}
                  onChange={(event) => {
                    setFundId(event.target.value)
                    onFundChange(event.target.value)
                  }}
                />
              )}
            </FormField>
            {positionsFailed ? (
              <Button
                size="sm"
                tone="secondary"
                onClick={() => {
                  void positions.refetch()
                }}
              >
                Load this investor&apos;s funds again
              </Button>
            ) : null}
          </div>

          {selectedPosition === null ? null : (
            <DataList>
              <DetailRow label="Amount invested">
                <MoneyValue amount={toPaise(selectedPosition.principalPaise)} size="sm" showDecimals />
              </DetailRow>
              <DetailRow label="Current value">
                <MoneyValue amount={toPaise(selectedPosition.currentValuePaise)} size="sm" showDecimals />
              </DetailRow>
              <DetailRow label="Gain so far">
                <MoneyValue amount={toPaise(selectedPosition.totalGrowthPaise)} size="sm" tone="signed" showSign showDecimals />
              </DetailRow>
              {draft.mode === "rate" && rateInBand ? <DetailRow label="Growth percentage">{formatRate(rate)}</DetailRow> : null}
              {adjustment === null || recorded !== undefined ? null : (
                <>
                  <DetailRow label={draft.mode === "rate" ? "Growth amount, taken from the invested amount" : "Growth amount"}>
                    <MoneyValue amount={toPaise(adjustment.delta.toString())} size="sm" tone="signed" showSign showDecimals />
                  </DetailRow>
                  <DetailRow label="Projected value after this adjustment">
                    <MoneyValue amount={toPaise(adjustment.projected.toString())} size="sm" showDecimals />
                  </DetailRow>
                </>
              )}
            </DataList>
          )}

          <GrowthAmountFields
            mode={draft.mode}
            basisPoints={draft.basisPoints}
            direction={draft.direction}
            rupees={draft.rupees}
            invalidRate={invalidRate}
            invalidAmount={invalidAmount}
            disabled={locked}
            onChange={edit}
          />

          <div className={ADMIN_FORM_GRID}>
            <FormField
              label="Effective date"
              required
              hint="Decides which month's statement it lands in."
              error={futureDated ? "The effective date cannot be later than today in India." : undefined}
            >
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  max={today}
                  value={draft.effectiveDate}
                  disabled={locked}
                  onChange={(event) => {
                    edit({ effectiveDate: event.target.value })
                  }}
                />
              )}
            </FormField>

            <FormField label="Reason code" required hint="The period this growth covers.">
              {({ id }) => (
                <Select
                  id={id}
                  options={GROWTH_REASON_OPTIONS.map((option) => ({ ...option }))}
                  value={draft.reasonCode}
                  disabled={locked}
                  onChange={(event) => {
                    edit({ reasonCode: event.target.value })
                  }}
                />
              )}
            </FormField>
          </div>

          <FormField label="Note" hint="Internal. Recorded on the batch, never shown to the investor.">
            {({ id }) => (
              <Input
                id={id}
                value={draft.note}
                maxLength={2_000}
                disabled={locked}
                onChange={(event) => {
                  edit({ note: event.target.value })
                }}
              />
            )}
          </FormField>

          {recorded === undefined && !unknown ? (
            <Button
              disabled={locked || incomplete}
              loading={write.pending}
              onClick={() => {
                setAsking("append")
              }}
              trailing
            >
              Review the adjustment
            </Button>
          ) : null}
        </div>
      </Card>

      {recorded === undefined ? null : <GrowthReceipt receipt={recorded} />}

      <GrowthConfirmDialogs
        asking={asking}
        investorLabel={investorLabel}
        fundName={funds.nameOf(fundId)}
        effectiveDate={draft.effectiveDate}
        reasonCode={draft.reasonCode}
        rateLabel={draft.mode === "rate" && rateInBand ? formatRate(rate) : null}
        position={selectedPosition}
        adjustment={adjustment}
        onAppend={append}
        onRestart={startNewAttempt}
        onCancel={() => {
          setAsking(null)
        }}
      />
    </>
  )
}
