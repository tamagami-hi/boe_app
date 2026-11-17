import { useState } from "react"

import { ApiError } from "~/api/errors"
import { initializeAdminFundAum } from "~/api/generated/operations"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useToast } from "~/app/providers/ToastProvider"
import { formatDate, indiaToday } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { paiseToRupeeText, parseRupees } from "~/features/admin/client-values/rupeeAmount"
import { useHeldDone } from "~/features/admin/shared/useHeldDone"
import { PersistedHoldNotices, isHeldOrUnreadable } from "~/features/admin/shared/PersistedHoldNotices"
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

const rateLimitText = (error: unknown): string => {
  const seconds = error instanceof ApiError ? error.retryAfterSeconds : null
  return seconds === null
    ? "Too many AUM writes just now. Wait, then record it again."
    : `Too many AUM writes just now. Record it again in ${String(seconds)}s.`
}

const rejectionText = (code: string | null, message: string, error: unknown): string => {
  if (code === "STATE_CONFLICT") {
    return "This fund already has an AUM, or it changed after the page loaded, so nothing was recorded. Reload the fund."
  }
  if (code === "RATE_LIMITED") return rateLimitText(error)
  if (code === "AUTHORIZATION_DENIED") return "Recording AUM needs the aum.write permission."
  return message
}

export type OpeningAumFormProps = Readonly<{
  fundId: string
  fundName: string
  hasAum: boolean
  onReload: () => void
}>

export const OpeningAumForm = ({ fundId, fundName, hasAum, onReload }: OpeningAumFormProps): React.ReactElement | null => {
  const initialize = useInitializeAum(fundId)
  const write = useHeldWrite(initialize, UNSENT, {
    slot: openingAumSlot(fundId),
    parseBody: parseOpeningBody,
    retention: "ordinary",
  })
  const { show } = useToast()
  const restored = write.held
  const [rupees, setRupees] = useState(() => (restored === null ? "0" : paiseToRupeeText(restored.aumPaise)))
  const [asOfDate, setAsOfDate] = useState(() => restored?.asOfDate ?? indiaToday())
  const [reasonCode, setReasonCode] = useState(() => restored?.reasonCode ?? "initial_aum")
  const [isAttempted, setAttempted] = useState(false)
  const [review, setReview] = useState<AumInitializeInput | null>(null)
  const { outcome } = write
  const isLocked = isHeldOrUnreadable(write)
  const aumPaise = parseRupees(rupees)
  const aumError =
    aumPaise === null && (isAttempted || rupees !== "")
      ? "Enter the opening AUM in rupees, with at most two decimal places. Zero is allowed."
      : undefined

  useHeldDone(outcome, () => {
    show("Opening AUM recorded.")
  })

  const notices = (
    <>
      <PersistedHoldNotices
        write={write}
        subject="the opening AUM was recorded"
        onReload={onReload}
        reloadLabel="Reload the fund"
        restartWarning="Check this fund's AUM history first. If an opening AUM is listed, it was recorded, and a new attempt will be refused. A new attempt cannot be matched to the unconfirmed one."
      />
      {outcome.kind === "rejected" ? (
        <Alert tone="error" title="Opening AUM not recorded">
          {rejectionText(outcome.code, outcome.message, initialize.error)}
        </Alert>
      ) : null}
    </>
  )

  if (hasAum) {
    if (!isLocked && outcome.kind !== "rejected") return null
    return (
      <Card>
        <Section
          title="Unconfirmed opening AUM"
          description="This fund now has an AUM, but an opening AUM sent from this tab was never confirmed. Settle it here before relying on the fund size."
        >
          {restored === null ? null : (
            <DataList>
              <DetailRow label="Opening AUM">
                <MoneyValue amount={toPaise(restored.aumPaise)} size="sm" showDecimals />
              </DetailRow>
              <DetailRow label="As of">{formatDate(`${restored.asOfDate}T00:00:00Z`)}</DetailRow>
              <DetailRow label="Reason code">{restored.reasonCode}</DetailRow>
            </DataList>
          )}
          {notices}
        </Section>
      </Card>
    )
  }

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
      {notices}
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
