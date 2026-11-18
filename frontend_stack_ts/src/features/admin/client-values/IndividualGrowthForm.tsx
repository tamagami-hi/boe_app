import { useEffect, useMemo, useState } from "react"

import { formatDate, indiaToday } from "~/domain/dates"
import { applyBasisPoints, toPaise } from "~/domain/money"
import { useAdminInvestorPositions } from "~/features/admin/shared/adminQueries"
import { useFundNames } from "~/features/admin/shared/fundNames"
import { HeldWriteNotice, UnsavedHoldNotice, isUnsavedHold } from "~/features/admin/shared/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { useUnloadGuard } from "~/features/admin/shared/useUnloadGuard"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyFootnote } from "~/ui/patterns/MoneyFootnote"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
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
import { DEFAULT_GROWTH_REASON, GROWTH_REASON_OPTIONS } from "./growthReasons"
import { useLegacyIndividualHold } from "./LegacyGrowthHold"
import {
  parseIndividualInvestmentGrowth,
  refKey,
  isTargetable,
  mustCategoriseFirst,
  useClientInvestments,
  useIndividualInvestmentGrowth,
  type AdminClientInvestment,
  type IndividualInvestmentGrowthHold,
} from "./investmentGrowthApi"
import { paiseToRupeeText, parsePositiveRupees } from "./rupeeAmount"

type Mode = "rate" | "amount"

const MIN_BASIS_POINTS = -2_000
const MAX_BASIS_POINTS = 2_000

const UNSENT = "This adjustment could not be sent. Reload the page and try again."

export const growthSlot = (userId: string): string => `investment-growth-individual:${userId}`

export const formatRate = (basisPoints: number): string => `${basisPoints > 0 ? "+" : ""}${String(basisPoints / 100)}%`

const describeRejection = (code: string | null, message: string): string =>
  code === "RESOURCE_NOT_FOUND" ? "That investment is not in this investor's fund, so there is nothing to adjust." : message

const targetLabel = (item: AdminClientInvestment): string =>
  item.date === null ? item.label : `${item.label}, ${formatDate(item.date)}`

type Draft = Readonly<{
  mode: Mode
  basisPoints: string
  direction: Direction
  rupees: string
  effectiveDate: string
  reasonCode: string
  note: string
}>

const draftOf = (held: IndividualInvestmentGrowthHold | null, today: string): Draft => {
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
  const mutation = useIndividualInvestmentGrowth()
  const write = useHeldWrite(mutation, UNSENT, {
    slot: growthSlot(userId),
    parseBody: parseIndividualInvestmentGrowth,
    retention: "ordinary",
  })
  const legacy = useLegacyIndividualHold(userId)
  const today = indiaToday()
  const [draft, setDraft] = useState<Draft>(() => draftOf(write.held, today))
  const [fundId, setFundId] = useState(() => write.held?.body.fundId ?? initialFundId)
  const [asking, setAsking] = useState<"append" | "restart" | null>(null)
  const positions = useAdminInvestorPositions(userId)
  const investments = useClientInvestments(userId)
  const [targetKey, setTargetKey] = useState(() => {
    const ref = write.held?.body.ref
    return ref === undefined ? "" : refKey(ref)
  })

  const edit = (patch: Partial<Draft>): void => {
    setDraft((current) => ({ ...current, ...patch }))
  }

  const recorded = mutation.data
  const unknown = write.outcome.kind === "unknown"
  const locked = write.held !== null || write.pending || write.unreadable || recorded !== undefined || legacy.locked
  const positionsFailed = userId !== "" && positions.data === undefined && positions.error != null
  const positionItems = positions.data?.items ?? []
  const selectedPosition = positionItems.find((position) => position.fundId === fundId) ?? null
  const fundInvestments = investments.data?.funds.find((fund) => fund.fundId === fundId)
  const investmentsFailed = fundId !== "" && investments.data === undefined && investments.error != null
  const categoriseFirst = fundInvestments !== undefined && mustCategoriseFirst(fundInvestments)
  const targets = categoriseFirst ? [] : (fundInvestments?.investments ?? []).filter(isTargetable)
  const selectedTarget = targets.find((item) => refKey(item.ref) === targetKey) ?? null
  const targetPrompt =
    investmentsFailed
      ? "This investor's investments could not be loaded"
      : investments.data === undefined
        ? "Loading this fund's investments"
        : targets.length === 0
          ? (fundInvestments?.uncategorised.length ?? 0) > 0
            ? "Its only investment is not categorised yet: use A whole fund"
            : "No investment can take growth"
          : "Choose an investment"
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
    selectedTarget === null ||
    !funds.ready ||
    draft.reasonCode === "" ||
    draft.effectiveDate === "" ||
    futureDated ||
    invalidRate ||
    invalidAmount

  const adjustment = useMemo(() => {
    if (selectedPosition === null || selectedTarget === null) return null
    const current = BigInt(selectedPosition.currentValuePaise)
    if (draft.mode === "amount") {
      if (signedPaise === null) return null
      const delta = BigInt(signedPaise)
      return { delta, projected: current + delta }
    }
    if (invalidRate) return null
    const delta = BigInt(applyBasisPoints(toPaise(selectedTarget.amountPaise), rate))
    return { delta, projected: current + delta }
  }, [selectedPosition, selectedTarget, draft.mode, signedPaise, invalidRate, rate])

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
    if (selectedTarget === null) return
    write.submit({
      body: {
        userId,
        fundId,
        ref: selectedTarget.ref,
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
      {legacy.notice}

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
                    setTargetKey("")
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

          {selectedPosition === null ? null : categoriseFirst ? (
            <Alert
              tone="warning"
              title="Categorise first"
              action={
                <ButtonLink to={`/users/${userId}?tab=ledger`} size="sm" tone="secondary">
                  Open the Ledger tab
                </ButtonLink>
              }
            >
              Sort this client&apos;s investments first: categorise their recordings and confirm any earlier growth split in
              the Ledger tab.
            </Alert>
          ) : (
            <div className={STACK_SM}>
              <FormField
                label="Target"
                required
                hint="The SIP or one one-time investment this growth applies to. A rate applies to its invested amount."
                error={investmentsFailed ? "This investor's investments could not be loaded." : undefined}
              >
                {({ id, invalid }) => (
                  <Select
                    id={id}
                    options={[
                      { value: "", label: targetPrompt },
                      ...targets.map((item) => ({ value: refKey(item.ref), label: targetLabel(item) })),
                    ]}
                    value={targetKey}
                    invalid={invalid}
                    disabled={locked || targets.length === 0}
                    onChange={(event) => {
                      setTargetKey(event.target.value)
                    }}
                  />
                )}
              </FormField>
              {investmentsFailed ? (
                <Button
                  size="sm"
                  tone="secondary"
                  onClick={() => {
                    void investments.refetch()
                  }}
                >
                  Load this investor&apos;s investments again
                </Button>
              ) : null}
            </div>
          )}

          {selectedPosition === null || selectedTarget === null ? null : (
            <DataList>
              <DetailRow label="Investment">{targetLabel(selectedTarget)}</DetailRow>
              <DetailRow label="This investment's invested amount">
                <MoneyValue amount={toPaise(selectedTarget.amountPaise)} size="sm" showDecimals />
              </DetailRow>
              <DetailRow label="Position invested">
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
                  <DetailRow label="Position total after this adjustment">
                    <MoneyValue amount={toPaise(adjustment.projected.toString())} size="sm" showDecimals />
                  </DetailRow>
                </>
              )}
            </DataList>
          )}
          {selectedTarget === null ? null : <MoneyFootnote lastUpdated={null} />}

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

      {recorded === undefined ? null : (
        <>
          <GrowthReceipt receipt={recorded} />
          <DataList>
            <DetailRow label="Investment">{recorded.part.label}</DetailRow>
            <DetailRow label="Investment value before">
              <MoneyValue amount={toPaise(recorded.part.beforePaise)} size="sm" showDecimals />
            </DetailRow>
            <DetailRow label="Investment value after">
              <MoneyValue amount={toPaise(recorded.part.afterPaise)} size="sm" showDecimals />
            </DetailRow>
          </DataList>
        </>
      )}

      <GrowthConfirmDialogs
        asking={asking}
        investorLabel={investorLabel}
        fundName={funds.nameOf(fundId)}
        effectiveDate={draft.effectiveDate}
        reasonCode={draft.reasonCode}
        rateLabel={draft.mode === "rate" && rateInBand ? formatRate(rate) : null}
        targetLabel={selectedTarget === null ? null : targetLabel(selectedTarget)}
        targetInvestedPaise={selectedTarget?.amountPaise ?? null}
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
