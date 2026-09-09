import { AdminAumGrowthBody } from "@beonedge/contracts"
import { useState } from "react"

import { isApiError, isTransportError } from "~/api/errors"
import { mintIdempotencyKey } from "~/api/idempotency"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useToast } from "~/app/providers/ToastProvider"
import { toPaise } from "~/domain/money"
import { useAppendAumGrowth } from "~/features/admin/shared/queries"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { ADMIN_FILTER, ADMIN_FILTER_ROW, ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

type AdjustmentMode = "target" | "amount" | "percent"

const isUncertainError = (error: unknown): boolean =>
  error !== null && (isTransportError(error) || !isApiError(error) || error.status >= 500)

const failureMessage = (error: unknown): string => {
  if (isTransportError(error)) return "Could not reach the backend. Retry to check whether the change was recorded."
  if (!isApiError(error)) return "The fund size could not be updated. Try again."
  const details = Object.values(error.fields ?? {}).flat().join(" ")
  if (details !== "") return details
  if (error.code === "STATE_CONFLICT") return "Check the current fund size and date, then try again. The fund size cannot become negative."
  return error.message
}

export const FundSizeAdjustmentForm = ({ fundId, currentAumPaise, currentAsOfDate }: Readonly<{
  fundId: string
  currentAumPaise: string
  currentAsOfDate: string | null
}>): React.ReactElement => {
  const growth = useAppendAumGrowth(fundId)
  const toast = useToast()
  const [mode, setMode] = useState<AdjustmentMode>("target")
  const [value, setValue] = useState("")
  const [asOfDate, setAsOfDate] = useState(() => {
    const today = new Date().toISOString().slice(0, 10)
    return currentAsOfDate !== null && currentAsOfDate > today ? currentAsOfDate : today
  })
  const [reasonCode, setReasonCode] = useState("fund_size_adjustment")
  const [note, setNote] = useState("")
  const [validationError, setValidationError] = useState<string | null>(null)
  const [pendingSubmission, setPendingSubmission] = useState<Readonly<{ body: AdminAumGrowthBody; idempotencyKey: string }> | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)
  const pendingBody = pendingSubmission?.body ?? null
  const hasUncertainOutcome = pendingSubmission !== null && isUncertainError(growth.error)

  const prepareAdjustment = (): void => {
    if (hasUncertainOutcome) {
      setIsConfirming(true)
      return
    }
    const parsed = AdminAumGrowthBody.safeParse({
      ...(mode === "target" ? { targetAumPaise: value } : mode === "amount"
        ? { growthPaise: value } : { growthBasisPoints: Number(value) }),
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
    growth.reset()
    setPendingSubmission({ body: parsed.data, idempotencyKey: mintIdempotencyKey() })
    setIsConfirming(true)
  }

  const confirmAdjustment = (): void => {
    if (pendingSubmission === null || growth.isPending) return
    growth.mutate(pendingSubmission, {
      onSuccess: () => {
        setPendingSubmission(null)
        setIsConfirming(false)
        setValue("")
        setNote("")
        toast.show("Fund size updated.")
      },
      onError: (error) => {
        if (isUncertainError(error)) return
        setPendingSubmission(null)
        setIsConfirming(false)
      },
    })
  }

  return (
    <>
      {validationError === null ? null : <Alert tone="error" title="Check the fund size change">{validationError}</Alert>}
      {growth.error === null ? null : <Alert tone="error" title={isUncertainError(growth.error) ? "Update not confirmed" : "Fund size not updated"}>{failureMessage(growth.error)}</Alert>}
      <form onSubmit={(event) => { event.preventDefault(); prepareAdjustment() }} className={STACK_LG}>
        <Card>
          <Section title="Manage fund size" description="Set a new total, or increase or decrease the current fund size. This updates the fund size shown to clients; individual investment balances stay separate.">
            <div className={ADMIN_FILTER_ROW} role="group" aria-label="Fund size change mode">
              {([
                ["target", "Set fund size"], ["amount", "Increase / decrease"], ["percent", "Percentage"],
              ] as const).map(([entryMode, label]) => (
                <button key={entryMode} type="button" disabled={hasUncertainOutcome} className={ADMIN_FILTER} aria-pressed={mode === entryMode} onClick={() => { setMode(entryMode); setValue(""); setValidationError(null) }}>
                  {label}
                </button>
              ))}
            </div>
            <div className={ADMIN_FORM_GRID}>
              <FormField required label={mode === "target" ? "New fund size (paise)" : mode === "amount" ? "Adjustment (paise)" : "Adjustment (basis points)"} hint={mode === "target" ? "Enter the complete new total. 100 paise = ₹1. Zero is allowed." : mode === "amount" ? "Use a positive value to increase or a minus sign to decrease. 100 paise = ₹1." : "100 basis points = 1%. Use a minus sign to decrease."}>
                {({ id, describedBy }) => <Input disabled={hasUncertainOutcome} id={id} aria-describedby={describedBy} required mono inputMode={mode === "target" ? "numeric" : "text"} pattern={mode === "target" ? "(0|[1-9][0-9]*)" : "-?(0|[1-9][0-9]*)"} value={value} onChange={(event) => { setValue(event.target.value) }} />}
              </FormField>
              <FormField label="As of date" required>
                {({ id }) => <Input disabled={hasUncertainOutcome} id={id} type="date" required min={currentAsOfDate ?? undefined} value={asOfDate} onChange={(event) => { setAsOfDate(event.target.value) }} />}
              </FormField>
              <FormField label="Reason code" required>
                {({ id }) => <Input disabled={hasUncertainOutcome} id={id} required value={reasonCode} onChange={(event) => { setReasonCode(event.target.value) }} />}
              </FormField>
              <FormField label="Note">
                {({ id }) => <Input disabled={hasUncertainOutcome} id={id} maxLength={2000} value={note} onChange={(event) => { setNote(event.target.value) }} />}
              </FormField>
            </div>
            <div className={ACTION_ROW}>
              <Button type="submit" size="lg" loading={growth.isPending}>{hasUncertainOutcome ? "Retry previous update" : "Review fund size change"}</Button>
            </div>
          </Section>
        </Card>
      </form>
      <ConfirmDialog open={isConfirming} title="Update fund size?" description="This change will appear in the fund history and the client fund view." confirmLabel={hasUncertainOutcome ? "Retry same update" : "Update fund size"} cancelLabel="Cancel" pending={growth.isPending} onConfirm={confirmAdjustment} onCancel={() => { if (!growth.isPending) { setIsConfirming(false); if (!hasUncertainOutcome) setPendingSubmission(null) } }}>
        <div className={STACK_LG}>
          {hasUncertainOutcome ? <Alert tone="error" title="Update not confirmed">Retry this same update to check its result without applying it twice.</Alert> : null}
          <div>Current fund size: <MoneyValue amount={toPaise(currentAumPaise)} showDecimals /></div>
          {pendingBody?.targetAumPaise === undefined ? null : <div>New fund size: <MoneyValue amount={toPaise(pendingBody.targetAumPaise)} showDecimals /></div>}
          {pendingBody?.growthPaise === undefined ? null : <div>Adjustment: <MoneyValue amount={toPaise(pendingBody.growthPaise)} showSign showDecimals /></div>}
          {pendingBody?.growthBasisPoints === undefined ? null : <div>Adjustment: {String(pendingBody.growthBasisPoints / 100)}%</div>}
          <div>As of: {pendingBody?.asOfDate}</div>
        </div>
      </ConfirmDialog>
    </>
  )
}
