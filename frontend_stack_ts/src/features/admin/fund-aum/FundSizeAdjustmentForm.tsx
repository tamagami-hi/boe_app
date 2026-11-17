import { useState } from "react"

import { appendAdminFundAumGrowth } from "~/api/generated/operations"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useToast } from "~/app/providers/ToastProvider"
import { formatDate, indiaToday } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { paiseToRupeeText, parseNonZeroSignedRupees, parseRupees } from "~/features/admin/client-values/rupeeAmount"
import { HeldNotKept } from "~/features/admin/funds/HeldNotKept"
import { useHeldDone } from "~/features/admin/funds/useHeldDone"
import { withoutRejection } from "~/features/admin/funds/withoutRejection"
import { HeldWriteNotice } from "~/features/admin/shared/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { AmountInput } from "~/ui/primitives/AmountInput"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { ADMIN_FILTER, ADMIN_FILTER_ROW, ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

import { useAppendAumGrowth } from "./aumQueries"
import type { AumGrowthInput } from "./aumQueries"

type AdjustmentMode = "target" | "amount" | "percent"

type ChangeField = Readonly<{ targetAumPaise: string } | { growthPaise: string } | { growthBasisPoints: number }>

const UNSENT = "The fund size change could not be sent. Reload the page and try again."
const RUPEES_ERROR = "Enter rupees with at most two decimal places."

const MODE_FIELD: Readonly<Record<AdjustmentMode, Readonly<{ label: string; hint: string }>>> = {
  target: { label: "New fund size", hint: "The complete new total in rupees, up to two decimal places. Zero is allowed." },
  amount: {
    label: "Adjustment in rupees",
    hint: "Up to two decimal places. A positive amount increases the size; start with a minus sign to decrease it.",
  },
  percent: { label: "Adjustment (basis points)", hint: "100 basis points = 1%. Use a minus sign to decrease." },
}

const MODES = [
  ["target", "Set fund size"],
  ["amount", "Increase / decrease"],
  ["percent", "Percentage"],
] as const

export const fundSizeSlot = (fundId: string): string => `fund-aum-growth:${fundId}`

const parseGrowthBody = (value: unknown): AumGrowthInput | null => {
  const parsed = appendAdminFundAumGrowth.request.body.safeParse(value)
  return parsed.success ? parsed.data : null
}

const changeFieldOf = (mode: AdjustmentMode, value: string): ChangeField | null => {
  const text = value.trim()
  if (mode === "percent") return { growthBasisPoints: Number(text) }
  if (mode === "target") {
    const targetAumPaise = parseRupees(text)
    return targetAumPaise === null ? null : { targetAumPaise }
  }
  const growthPaise = parseNonZeroSignedRupees(text)
  return growthPaise === null ? null : { growthPaise }
}

const signedRupeeText = (paise: string): string =>
  paise.startsWith("-") ? `-${paiseToRupeeText(paise.slice(1))}` : paiseToRupeeText(paise)

const modeOf = (body: AumGrowthInput | null): AdjustmentMode => {
  if (body?.growthPaise !== undefined) return "amount"
  if (body?.growthBasisPoints !== undefined) return "percent"
  return "target"
}

const valueOf = (body: AumGrowthInput | null): string => {
  if (body === null) return ""
  if (body.targetAumPaise !== undefined) return paiseToRupeeText(body.targetAumPaise)
  if (body.growthPaise !== undefined) return signedRupeeText(body.growthPaise)
  return body.growthBasisPoints === undefined ? "" : String(body.growthBasisPoints)
}

const rejectionText = (code: string | null, message: string, fields: Readonly<Record<string, readonly string[]>>): string => {
  const details = Object.values(fields).flat().join(" ")
  if (details !== "") return details
  if (code === "STATE_CONFLICT") return "Check the current fund size and date, then try again. The fund size cannot become negative."
  if (code === "AUTHORIZATION_DENIED") return "Recording AUM needs the aum.write permission."
  return message
}

export type FundSizeAdjustmentFormProps = Readonly<{
  fundId: string
  fundName: string
  currentAumPaise: string
  currentAsOfDate: string | null
  onReload: () => void
}>

export const FundSizeAdjustmentForm = ({
  fundId,
  fundName,
  currentAumPaise,
  currentAsOfDate,
  onReload,
}: FundSizeAdjustmentFormProps): React.ReactElement => {
  const write = useHeldWrite(useAppendAumGrowth(fundId), UNSENT, { slot: fundSizeSlot(fundId), parseBody: parseGrowthBody })
  const { show } = useToast()
  const restored = write.held
  const [mode, setMode] = useState<AdjustmentMode>(() => modeOf(restored))
  const [value, setValue] = useState(() => valueOf(restored))
  const [asOfDate, setAsOfDate] = useState(() => {
    if (restored !== null) return restored.asOfDate
    const today = indiaToday()
    return currentAsOfDate !== null && currentAsOfDate > today ? currentAsOfDate : today
  })
  const [reasonCode, setReasonCode] = useState(() => restored?.reasonCode ?? "fund_size_adjustment")
  const [note, setNote] = useState(() => restored?.note ?? "")
  const [validationError, setValidationError] = useState<string | null>(null)
  const [review, setReview] = useState<AumGrowthInput | null>(null)
  const { outcome } = write
  const isLocked = write.held !== null

  useHeldDone(outcome, () => {
    setValue("")
    setNote("")
    show("Fund size updated.")
  })

  const prepareAdjustment = (): void => {
    if (isLocked) return
    const change = changeFieldOf(mode, value)
    if (change === null) {
      setValidationError(mode === "amount" ? `${RUPEES_ERROR} The adjustment cannot be zero.` : RUPEES_ERROR)
      return
    }
    const parsed = appendAdminFundAumGrowth.request.body.safeParse({
      ...change,
      asOfDate,
      reasonCode: reasonCode.trim(),
      ...(note.trim() === "" ? {} : { note: note.trim() }),
    })
    if (!parsed.success) {
      setValidationError(parsed.error.issues.map((issue) => issue.message).join(" "))
      return
    }
    if (parsed.data.targetAumPaise === currentAumPaise) {
      setValidationError("Enter a new fund size that differs from the current size.")
      return
    }
    setValidationError(null)
    setReview(parsed.data)
  }

  return (
    <>
      {validationError === null ? null : <Alert tone="error" title="Check the fund size change">{validationError}</Alert>}
      <HeldWriteNotice
        write={withoutRejection(write)}
        subject="the fund size was updated"
        onReload={onReload}
        reloadLabel="Reload the fund"
      />
      {outcome.kind === "unknown" && !write.persisted ? <HeldNotKept /> : null}
      {outcome.kind === "rejected" ? (
        <Alert tone="error" title="Fund size not updated">
          {rejectionText(outcome.code, outcome.message, outcome.fields)}
        </Alert>
      ) : null}
      <form onSubmit={(event) => { event.preventDefault(); prepareAdjustment() }} className={STACK_LG}>
        <Card>
          <Section title="Manage fund size" description="Set a new total, or increase or decrease the current fund size. This updates the fund size shown to clients; individual investment balances stay separate.">
            <div className={ADMIN_FILTER_ROW} role="group" aria-label="Fund size change mode">
              {MODES.map(([entryMode, label]) => (
                <button key={entryMode} type="button" disabled={isLocked} className={ADMIN_FILTER} aria-pressed={mode === entryMode} onClick={() => { setMode(entryMode); setValue(""); setValidationError(null) }}>
                  {label}
                </button>
              ))}
            </div>
            <div className={ADMIN_FORM_GRID}>
              <FormField required label={MODE_FIELD[mode].label} hint={MODE_FIELD[mode].hint}>
                {({ id, describedBy }) => mode === "target"
                  ? <AmountInput disabled={isLocked} id={id} describedBy={describedBy} decimals value={value} onChange={setValue} />
                  : <Input disabled={isLocked} id={id} aria-describedby={describedBy} required mono inputMode="text" pattern={mode === "amount" ? "-?(0|[1-9][0-9]*)(\\.[0-9]{1,2})?" : "-?(0|[1-9][0-9]*)"} value={value} onChange={(event) => { setValue(event.target.value) }} />}
              </FormField>
              <FormField label="As of date" required>
                {({ id }) => <Input disabled={isLocked} id={id} type="date" required min={currentAsOfDate ?? undefined} value={asOfDate} onChange={(event) => { setAsOfDate(event.target.value) }} />}
              </FormField>
              <FormField label="Reason code" required>
                {({ id }) => <Input disabled={isLocked} id={id} required value={reasonCode} onChange={(event) => { setReasonCode(event.target.value) }} />}
              </FormField>
              <FormField label="Note">
                {({ id }) => <Input disabled={isLocked} id={id} maxLength={2000} value={note} onChange={(event) => { setNote(event.target.value) }} />}
              </FormField>
            </div>
            <div className={ACTION_ROW}>
              <Button type="submit" size="lg" loading={write.pending} disabled={isLocked}>Review fund size change</Button>
            </div>
          </Section>
        </Card>
      </form>
      <ConfirmDialog
        open={review !== null}
        title={`Update the size of ${fundName}?`}
        description="This change will appear in the fund history and the client fund view."
        confirmLabel="Update fund size"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (review === null) return
          setReview(null)
          write.submit(review)
        }}
        onCancel={() => { setReview(null) }}
      >
        {review === null ? null : (
          <DataList>
            <DetailRow label="Fund">{fundName}</DetailRow>
            <DetailRow label="Current fund size"><MoneyValue amount={toPaise(currentAumPaise)} size="sm" showDecimals /></DetailRow>
            {review.targetAumPaise === undefined ? null : (
              <DetailRow label="New fund size" emphasis="lead"><MoneyValue amount={toPaise(review.targetAumPaise)} size="sm" showDecimals /></DetailRow>
            )}
            {review.growthPaise === undefined ? null : (
              <DetailRow label="Adjustment" emphasis="lead"><MoneyValue amount={toPaise(review.growthPaise)} size="sm" showSign showDecimals /></DetailRow>
            )}
            {review.growthBasisPoints === undefined ? null : (
              <DetailRow label="Adjustment" emphasis="lead">{`${String(review.growthBasisPoints / 100)}%`}</DetailRow>
            )}
            <DetailRow label="As of">{formatDate(`${review.asOfDate}T00:00:00Z`)}</DetailRow>
            <DetailRow label="Reason code">{review.reasonCode}</DetailRow>
          </DataList>
        )}
      </ConfirmDialog>
    </>
  )
}
