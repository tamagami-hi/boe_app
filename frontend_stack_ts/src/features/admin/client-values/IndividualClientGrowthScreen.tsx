import { useMemo, useState } from "react"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { useIdempotencyKey } from "~/api/idempotency"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { applyBasisPoints, toPaise } from "~/domain/money"
import { useAdminInvestorPositions } from "~/features/admin/shared/adminQueries"
import { useAdminFundCatalogue } from "~/features/admin/shared/queries"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { AmountInput } from "~/ui/primitives/AmountInput"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { RadioGroup } from "~/ui/primitives/Toggle"
import { Select } from "~/ui/primitives/Select"

import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { ACTION_ROW, STACK_LG, STACK_SM } from "~/ui/recipes/layout"

import { GrowthReceipt } from "./GrowthReceipt"
import { useIndividualClientGrowth } from "./growthQueries"
import type { IndividualGrowthInput } from "./growthQueries"
import { DEFAULT_GROWTH_REASON, GROWTH_REASON_OPTIONS } from "./growthReasons"
import { indiaToday } from "./indiaToday"
import { InvestorPicker } from "./InvestorPicker"
import { parsePositiveRupees } from "./rupeeAmount"

type Mode = "rate" | "amount"

type Direction = "increase" | "decrease"

const DIRECTION_OPTIONS = [
  { value: "increase", label: "Raise the value" },
  { value: "decrease", label: "Lower the value" },
] as const

type Outcome =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "rejected"; message: string }>
  | Readonly<{ kind: "unknown" }>

const IDLE: Outcome = { kind: "idle" }

const MIN_BASIS_POINTS = -2_000
const MAX_BASIS_POINTS = 2_000

const formatRate = (basisPoints: number): string =>
  `${basisPoints > 0 ? "+" : ""}${String(basisPoints / 100)}%`

const describeRejection = (error: unknown): string => {
  if (!isApiError(error)) return "This adjustment could not be sent. Reload the page and try again."
  if (error.code === "RESOURCE_NOT_FOUND") {
    return "That investor has no contribution in that fund, so there is nothing to adjust."
  }
  return error.message
}

const IndividualClientGrowthScreen = (): React.ReactElement => {
  const funds = useAdminFundCatalogue()
  const growth = useIndividualClientGrowth()

  const [mode, setMode] = useState<Mode>("rate")
  const [userId, setUserId] = useState("")
  const [fundId, setFundId] = useState("")
  const [basisPoints, setBasisPoints] = useState("")
  const [direction, setDirection] = useState<Direction>("increase")
  const [rupees, setRupees] = useState("")
  const [effectiveDate, setEffectiveDate] = useState(indiaToday)
  const [reasonCode, setReasonCode] = useState<string>(DEFAULT_GROWTH_REASON)
  const [note, setNote] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [outcome, setOutcome] = useState<Outcome>(IDLE)
  const [held, setHeld] = useState<IndividualGrowthInput | null>(null)
  const [confirmingRestart, setConfirmingRestart] = useState(false)

  const positions = useAdminInvestorPositions(userId)

  const fundName = (id: string): string => {
    const fund = (funds.data?.items ?? []).find((entry) => entry.id === id)
    return fund?.name ?? fund?.slug ?? id
  }

  const positionsFailed = userId !== "" && positions.data === undefined && positions.error != null
  const positionItems = positions.data?.items ?? []
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
  const fundOptions = [
    { value: "", label: fundPrompt },
    ...positionItems.map((position) => ({
      value: position.fundId,
      label: fundName(position.fundId),
    })),
  ]

  const selectedPosition = positionItems.find((position) => position.fundId === fundId) ?? null

  const recorded = growth.data
  const locked = growth.isPending || outcome.kind === "unknown" || recorded !== undefined
  const today = indiaToday()
  const futureDated = effectiveDate > today

  const rate = Number(basisPoints)
  const rateInBand = Number.isInteger(rate) && rate !== 0 && rate >= MIN_BASIS_POINTS && rate <= MAX_BASIS_POINTS
  const invalidRate = mode === "rate" && !rateInBand
  const magnitudePaise = parsePositiveRupees(rupees)
  const signedPaise =
    magnitudePaise === null ? null : direction === "decrease" ? `-${magnitudePaise}` : magnitudePaise
  const invalidAmount = mode === "amount" && signedPaise === null
  const incomplete =
    userId === "" ||
    fundId === "" ||
    reasonCode === "" ||
    effectiveDate === "" ||
    futureDated ||
    invalidRate ||
    invalidAmount

  const trimmedNote = note.trim()
  const body = {
    userId,
    fundId,
    effectiveDate,
    reasonCode,
    ...(trimmedNote === "" ? {} : { note: trimmedNote }),
    ...(mode === "rate" ? { growthBasisPoints: rate } : { growthPaise: signedPaise ?? "" }),
  }
  const idempotencyKey = useIdempotencyKey({ ...body, attempt })

  const adjustment = useMemo(() => {
    if (selectedPosition === null) return null
    const current = BigInt(selectedPosition.currentValuePaise)
    if (mode === "amount") {
      if (signedPaise === null) return null
      const delta = BigInt(signedPaise)
      return { delta, projected: current + delta }
    }
    if (invalidRate) return null
    const delta = BigInt(applyBasisPoints(toPaise(selectedPosition.principalPaise), rate))
    return { delta, projected: current + delta }
  }, [selectedPosition, mode, signedPaise, invalidRate, rate])

  const send = (input: IndividualGrowthInput): void => {
    setHeld(input)
    if (outcome.kind === "rejected") setOutcome(IDLE)
    growth.mutate(input, {
      onSuccess: () => {
        setOutcome(IDLE)
      },
      onError: (error) => {
        setOutcome(
          isUnknownWriteOutcome(error)
            ? { kind: "unknown" }
            : { kind: "rejected", message: describeRejection(error) },
        )
      },
    })
  }

  const submit = (): void => {
    send({ idempotencyKey, body })
  }

  const checkAgain = (): void => {
    if (held !== null) send(held)
  }

  const startNewAttempt = (): void => {
    setConfirmingRestart(false)
    setAttempt((current) => current + 1)
    setOutcome(IDLE)
    setHeld(null)
    growth.reset()
  }

  const adjustAgain = (): void => {
    setBasisPoints("")
    setRupees("")
    setNote("")
    startNewAttempt()
  }

  return (
    <Page width="default">
      <PageHeader
        title="Adjust one investor"
        description="Appends a growth entry against one position. A rate is measured against the amount invested, so it does not compound; the amount invested itself never moves. Read the projected value before committing — the server recalculates it authoritatively and its response is the truth."
      />

      {outcome.kind === "rejected" ? (
        <Alert tone="error" title="Not recorded">
          {outcome.message}
        </Alert>
      ) : null}

      {outcome.kind === "unknown" ? (
        <Alert
          tone="warning"
          title="Not confirmed"
          action={
            <span className={ACTION_ROW}>
              <Button size="sm" loading={growth.isPending} onClick={checkAgain}>
                Check again
              </Button>
              <Button
                size="sm"
                tone="secondary"
                disabled={growth.isPending}
                onClick={() => {
                  setConfirmingRestart(true)
                }}
              >
                Start a new attempt
              </Button>
            </span>
          }
        >
          The reply did not arrive, so it is not known whether this adjustment was appended. The form
          is held on this exact request. Check again sends it once more under the same key, and the
          same request can only ever be appended once. It may also already appear in this
          investor&apos;s ledger entries.
        </Alert>
      ) : null}

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
          The ledger entry is written and the investor has been notified. The form is held so the
          same adjustment cannot be appended twice by mistake.
        </Alert>
      )}

      <Card elevated>
        <div className={STACK_LG}>
          <FormField label="How are you adjusting it">
            {() => (
              <RadioGroup<Mode>
                legend="Adjustment mode"
                value={mode}
                onChange={(next) => {
                  if (!locked) setMode(next)
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

          <InvestorPicker
            userId={userId}
            hint="Search by name, email or phone. Only investors with a holding can be adjusted."
            disabled={locked}
            onChange={(choice) => {
              setUserId(choice.userId)
              setFundId("")
            }}
          />

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
                  options={fundOptions}
                  value={fundId}
                  invalid={invalid}
                  disabled={locked || positionItems.length === 0}
                  onChange={(event) => {
                    setFundId(event.target.value)
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
                <MoneyValue amount={toPaise(selectedPosition.principalPaise)} size="sm" />
              </DetailRow>
              <DetailRow label="Current value">
                <MoneyValue amount={toPaise(selectedPosition.currentValuePaise)} size="sm" />
              </DetailRow>
              <DetailRow label="Gain so far">
                <MoneyValue
                  amount={toPaise(selectedPosition.totalGrowthPaise)}
                  size="sm"
                  tone="signed"
                  showSign
                />
              </DetailRow>
              {mode === "rate" && rateInBand ? (
                <DetailRow label="Growth percentage">{formatRate(rate)}</DetailRow>
              ) : null}
              {adjustment === null || recorded !== undefined ? null : (
                <>
                  <DetailRow
                    label={
                      mode === "rate" ? "Growth amount, taken from the invested amount" : "Growth amount"
                    }
                  >
                    <MoneyValue
                      amount={toPaise(adjustment.delta.toString())}
                      size="sm"
                      tone="signed"
                      showSign
                    />
                  </DetailRow>
                  <DetailRow label="Projected value after this adjustment">
                    <MoneyValue amount={toPaise(adjustment.projected.toString())} size="sm" />
                  </DetailRow>
                </>
              )}
            </DataList>
          )}

          {mode === "rate" ? (
            <FormField
              label="Rate in basis points"
              required
              hint="Between -2000 and 2000, and not zero. 500 is +5% of the amount invested."
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
                  }}
                />
              )}
            </FormField>
          ) : (
            <div className={ADMIN_FORM_GRID}>
              <FormField label="Direction" required>
                {({ id }) => (
                  <Select
                    id={id}
                    options={DIRECTION_OPTIONS.map((option) => ({ ...option }))}
                    value={direction}
                    disabled={locked}
                    onChange={(event) => {
                      setDirection(event.target.value === "decrease" ? "decrease" : "increase")
                    }}
                  />
                )}
              </FormField>
              <FormField
                label="Amount in rupees"
                required
                hint="Up to two decimal places, for example 500 or 500.50."
                error={
                  invalidAmount && rupees !== ""
                    ? "Enter an amount above zero in rupees, with at most two decimal places."
                    : undefined
                }
              >
                {({ id, describedBy, invalid }) => (
                  <AmountInput
                    id={id}
                    value={rupees}
                    decimals
                    invalid={invalid}
                    describedBy={describedBy}
                    disabled={locked}
                    onChange={setRupees}
                  />
                )}
              </FormField>
            </div>
          )}

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

          <FormField label="Note" hint="Internal. Recorded on the batch, never shown to the investor.">
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

          {recorded === undefined && outcome.kind !== "unknown" ? (
            <Button disabled={locked || incomplete} loading={growth.isPending} onClick={submit} trailing>
              Append the adjustment
            </Button>
          ) : null}
        </div>
      </Card>

      {recorded === undefined ? null : <GrowthReceipt receipt={recorded} />}

      <ConfirmDialog
        open={confirmingRestart}
        title="Start a new attempt?"
        description="Check this investor's ledger entries first. If this adjustment is already listed, it was appended, and a new attempt would append it a second time. A new attempt cannot be matched to the unconfirmed one."
        confirmLabel="Start a new attempt"
        confirmTone="danger"
        cancelLabel="Keep this attempt"
        onConfirm={startNewAttempt}
        onCancel={() => {
          setConfirmingRestart(false)
        }}
      />
    </Page>
  )
}

export default IndividualClientGrowthScreen
