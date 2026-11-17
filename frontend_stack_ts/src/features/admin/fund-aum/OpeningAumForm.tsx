import { useState } from "react"

import { initializeAdminFundAum } from "~/api/generated/operations"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useToast } from "~/app/providers/ToastProvider"
import { formatDate, indiaToday } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { paiseToRupeeText, parseRupees } from "~/features/admin/client-values/rupeeAmount"
import { HeldNotKept } from "~/features/admin/funds/HeldNotKept"
import { useHeldDone } from "~/features/admin/funds/useHeldDone"
import { HeldWriteNotice } from "~/features/admin/shared/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { AmountInput } from "~/ui/primitives/AmountInput"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"

import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

import { useInitializeAum } from "./aumQueries"
import type { AumInitializeInput } from "./aumQueries"

const UNSENT = "The opening AUM could not be sent. Reload the page and try again."

const parseOpeningBody = (value: unknown): AumInitializeInput | null => {
  const parsed = initializeAdminFundAum.request.body.safeParse(value)
  return parsed.success ? parsed.data : null
}

export const openingAumSlot = (fundId: string): string => `fund-aum-opening:${fundId}`

const rejectionText = (code: string | null, message: string): string => {
  if (code === "STATE_CONFLICT") {
    return "This fund already has an AUM, or it changed after the page loaded, so nothing was recorded. Reload the fund."
  }
  if (code === "RATE_LIMITED") return "Too many AUM writes just now. Wait, then record it again."
  if (code === "AUTHORIZATION_DENIED") return "Recording AUM needs the aum.write permission."
  return message
}

export type OpeningAumFormProps = Readonly<{
  fundId: string
  fundName: string
  onReload: () => void
}>

export const OpeningAumForm = ({ fundId, fundName, onReload }: OpeningAumFormProps): React.ReactElement => {
  const write = useHeldWrite(useInitializeAum(fundId), UNSENT, {
    slot: openingAumSlot(fundId),
    parseBody: parseOpeningBody,
  })
  const { show } = useToast()
  const restored = write.held
  const [rupees, setRupees] = useState(() => (restored === null ? "0" : paiseToRupeeText(restored.aumPaise)))
  const [asOfDate, setAsOfDate] = useState(() => restored?.asOfDate ?? indiaToday())
  const [reasonCode, setReasonCode] = useState(() => restored?.reasonCode ?? "initial_aum")
  const [isAttempted, setAttempted] = useState(false)
  const [review, setReview] = useState<AumInitializeInput | null>(null)
  const { outcome } = write
  const isLocked = write.held !== null
  const aumPaise = parseRupees(rupees)
  const aumError =
    aumPaise === null && (isAttempted || rupees !== "")
      ? "Enter the opening AUM in rupees, with at most two decimal places. Zero is allowed."
      : undefined

  useHeldDone(outcome, () => {
    show("Opening AUM recorded.")
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        setAttempted(true)
        if (aumPaise === null || isLocked) return
        setReview({ aumPaise, asOfDate, reasonCode })
      }}
      noValidate
      className={STACK_LG}
    >
      {outcome.kind === "unknown" ? (
        <HeldWriteNotice write={write} subject="the opening AUM was recorded" onReload={onReload} reloadLabel="Reload the fund" />
      ) : null}
      {outcome.kind === "unknown" && !write.persisted ? <HeldNotKept /> : null}
      {outcome.kind === "rejected" ? (
        <Alert tone="error" title="Opening AUM not recorded">
          {rejectionText(outcome.code, outcome.message)}
        </Alert>
      ) : null}
      <Card>
        <Section
          title="Set opening AUM"
          description="This fund has no AUM yet. Record the absolute size once; you can increase or decrease it afterward."
        >
          <div className={ADMIN_FORM_GRID}>
            <FormField label="Opening AUM" required hint="In rupees, up to two decimal places." error={aumError}>
              {({ id, describedBy, invalid }) => (
                <AmountInput
                  id={id}
                  decimals
                  disabled={isLocked}
                  value={rupees}
                  invalid={invalid}
                  describedBy={describedBy}
                  onChange={setRupees}
                />
              )}
            </FormField>
            <FormField label="As of date" required>
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  required
                  disabled={isLocked}
                  value={asOfDate}
                  onChange={(event) => {
                    setAsOfDate(event.target.value)
                  }}
                />
              )}
            </FormField>
            <FormField label="Reason code" required>
              {({ id }) => (
                <Input
                  id={id}
                  required
                  disabled={isLocked}
                  value={reasonCode}
                  onChange={(event) => {
                    setReasonCode(event.target.value)
                  }}
                />
              )}
            </FormField>
          </div>
          <div className={ACTION_ROW}>
            <Button type="submit" size="lg" loading={write.pending} disabled={isLocked}>
              Review the opening AUM
            </Button>
          </div>
        </Section>
      </Card>

      <ConfirmDialog
        open={review !== null}
        title={`Record the opening AUM of ${fundName}?`}
        description="This sets the fund size investors see. A later change is a growth entry, never an edit."
        confirmLabel="Record opening AUM"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (review === null) return
          setReview(null)
          write.submit(review)
        }}
        onCancel={() => {
          setReview(null)
        }}
      >
        {review === null ? null : (
          <DataList>
            <DetailRow label="Fund">{fundName}</DetailRow>
            <DetailRow label="Opening AUM" emphasis="lead">
              <MoneyValue amount={toPaise(review.aumPaise)} size="sm" showDecimals />
            </DetailRow>
            <DetailRow label="As of">{formatDate(`${review.asOfDate}T00:00:00Z`)}</DetailRow>
            <DetailRow label="Reason code">{review.reasonCode}</DetailRow>
          </DataList>
        )}
      </ConfirmDialog>
    </form>
  )
}
