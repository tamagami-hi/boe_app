import { useEffect, useState } from "react"

import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDate, indiaToday } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { useFundNames } from "~/features/admin/shared/fundNames"
import { HeldWriteNotice, UnsavedHoldNotice, isUnsavedHold } from "~/features/admin/shared/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { useUnloadGuard } from "~/features/admin/shared/useUnloadGuard"
import { DataList, DetailRow, Prose } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { AmountInput } from "~/ui/primitives/AmountInput"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { Select } from "~/ui/primitives/Select"
import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

import { CatalogueFundPicker } from "./CatalogueFundPicker"
import {
  DEFAULT_RECORDING_REASON,
  RECORDING_CATEGORIES,
  isRecordingReason,
  recordingCategoryCopy,
} from "./recordingCategories"
import { MONTHLY_RECORDING_REASON, type RecordingPrefill } from "./recordingPrefill"
import { parseRecordedContribution } from "./heldBodies"
import { useRecordClientContribution } from "./recordingQueries"
import { paiseToRupeeText, parsePositiveRupees } from "./rupeeAmount"
import { SipMonthLinkField } from "./SipMonthLinkField"
import { sipMonthLabel, useSipMonthLink } from "./sipMonthLink"

const CATEGORY_OPTIONS = RECORDING_CATEGORIES.map((category) => ({
  value: category.value,
  label: category.label,
}))

const NOTE_MAX_LENGTH = 2_000

const UNSENT = "This investment could not be sent. Reload the page and try again."

export type RecordingHold = "none" | "held" | "unsaved"

export const recordingSlot = (userId: string): string => `record:${userId}`

const describeRejection = (code: string | null, message: string, fields: Readonly<Record<string, readonly string[]>>): string => {
  const linkRefusals = Object.entries(fields).filter(([field]) => field.startsWith("sipScheduleLink"))
  if (linkRefusals.length > 0) {
    return `SIP schedule month: ${linkRefusals.flatMap(([, messages]) => messages).join(" ")}`
  }
  if (code === "RESOURCE_NOT_FOUND") return "That investor or fund could not be found. Check the selection and try again."
  return message
}

export type EarlierInvestmentFormProps = Readonly<{
  userId: string
  investorLabel: string
  prefill?: RecordingPrefill
  onHoldChange?: (hold: RecordingHold) => void
}>

export const EarlierInvestmentForm = ({
  userId,
  investorLabel,
  prefill,
  onHoldChange,
}: EarlierInvestmentFormProps): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canWrite = hasAnyPermission(["client_position.write"])
  const funds = useFundNames()
  const mutation = useRecordClientContribution()
  const record = useHeldWrite(mutation, UNSENT, {
    slot: recordingSlot(userId),
    parseBody: parseRecordedContribution,
    retention: "durable",
  })
  const held = record.held

  const [fundId, setFundId] = useState(() => held?.fundId ?? prefill?.fundId ?? "")
  const [rupees, setRupees] = useState(() => (held === null ? (prefill?.rupees ?? "") : paiseToRupeeText(held.amountPaise)))
  const [effectiveDate, setEffectiveDate] = useState(() => held?.effectiveDate ?? prefill?.effectiveDate ?? "")
  const [reasonCode, setReasonCode] = useState(() => held?.reasonCode ?? prefill?.reasonCode ?? DEFAULT_RECORDING_REASON)
  const [note, setNote] = useState(() => held?.note ?? "")
  const [confirmingRecord, setConfirmingRecord] = useState(false)
  const [confirmingRestart, setConfirmingRestart] = useState(false)

  const category = recordingCategoryCopy(reasonCode)
  const sipLink = useSipMonthLink(
    userId,
    fundId,
    reasonCode === MONTHLY_RECORDING_REASON,
    held === null ? (prefill?.sipMonth ?? null) : (held.sipScheduleLink ?? null),
  )
  const amountPaise = parsePositiveRupees(rupees)
  const trimmedNote = note.trim()

  const recorded = mutation.data
  const holding = held !== null || record.pending
  const unknown = record.outcome.kind === "unknown"
  const locked = !canWrite || holding || record.unreadable || recorded !== undefined
  const hold: RecordingHold = held === null ? "none" : isUnsavedHold(record) ? "unsaved" : "held"
  useUnloadGuard(hold === "unsaved")

  useEffect(() => {
    onHoldChange?.(hold)
    return () => {
      onHoldChange?.("none")
    }
  }, [hold, onHoldChange])

  const today = indiaToday()
  const futureDated = effectiveDate !== "" && effectiveDate > today
  const amountInvalid = rupees !== "" && amountPaise === null
  const incomplete = fundId === "" || effectiveDate === "" || futureDated || amountPaise === null || sipLink.blocking

  const send = (): void => {
    setConfirmingRecord(false)
    if (amountPaise === null) return
    sipLink.choose(sipLink.selected)
    record.submit({
      userId,
      fundId,
      amountPaise,
      effectiveDate,
      reasonCode,
      ...(trimmedNote === "" ? {} : { note: trimmedNote }),
      ...(sipLink.link === null ? {} : { sipScheduleLink: sipLink.link }),
    })
  }

  const startNewAttempt = (): void => {
    setConfirmingRestart(false)
    record.reset()
  }

  const recordAnother = (): void => {
    setFundId("")
    setRupees("")
    setEffectiveDate("")
    setReasonCode(DEFAULT_RECORDING_REASON)
    setNote("")
    sipLink.reset()
    record.reset()
  }

  return (
    <Card elevated>
      <div className={STACK_LG}>
        {canWrite ? null : (
          <Alert tone="info" title="Read only">
            Your role cannot record investments.
          </Alert>
        )}

        {record.outcome.kind === "rejected" ? (
          <Alert tone="error" title="Not recorded">
            {describeRejection(record.outcome.code, record.outcome.message, record.outcome.fields)}
          </Alert>
        ) : null}

        {unknown && !record.expired ? (
          <Alert
            tone="warning"
            title="Not confirmed"
            action={
              <span className={ACTION_ROW}>
                <Button size="sm" loading={record.pending} onClick={record.checkAgain}>
                  Check again
                </Button>
                <Button
                  size="sm"
                  tone="secondary"
                  disabled={record.pending}
                  onClick={() => {
                    setConfirmingRestart(true)
                  }}
                >
                  Start a new attempt
                </Button>
              </span>
            }
          >
            The reply did not arrive, so it is not known whether this investment was recorded. The form is held on this
            exact request. Check again sends it once more, and the same request can only ever be recorded once. It may
            also already appear in this investor&apos;s ledger entries.
          </Alert>
        ) : record.outcome.kind === "rejected" ? null : (
          <HeldWriteNotice
            write={{
              outcome: record.outcome,
              pending: record.pending,
              checkAgain: record.checkAgain,
              unreadable: record.unreadable,
              expired: record.expired,
            }}
            subject="this investment was recorded"
            reloadLabel="Start a new attempt"
            onReload={() => {
              setConfirmingRestart(true)
            }}
          />
        )}
        <UnsavedHoldNotice write={record} />

        {recorded === undefined ? null : (
          <Alert
            tone="success"
            title={category.recordedTitle}
            action={
              <Button size="sm" tone="secondary" onClick={recordAnother}>
                Record another investment
              </Button>
            }
          >
            The investor has been notified. In this fund they have now invested{" "}
            <MoneyValue amount={toPaise(recorded.principalPaise)} size="sm" showDecimals />, with a current value of{" "}
            <MoneyValue amount={toPaise(recorded.currentValuePaise)} size="sm" showDecimals />.
            {recorded.fundVersionEffectiveOnDate
              ? ""
              : " No fund version existed on that date, so the current published version was recorded instead."}
          </Alert>
        )}

        <div className={ADMIN_FORM_GRID}>
          <CatalogueFundPicker value={fundId} disabled={locked} onChange={setFundId} />

          <FormField
            label="Amount in rupees"
            required
            hint={category.amountHint}
            error={amountInvalid ? "Enter an amount above zero in rupees, with at most two decimal places." : undefined}
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

        <div className={ADMIN_FORM_GRID}>
          <FormField
            label={category.dateLabel}
            required
            hint={category.dateHint}
            error={futureDated ? category.futureDateError : undefined}
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

          <FormField label="Category" required hint="The client sees this label on their receipt.">
            {({ id }) => (
              <Select
                id={id}
                options={CATEGORY_OPTIONS}
                value={reasonCode}
                disabled={locked}
                onChange={(event) => {
                  if (isRecordingReason(event.target.value)) setReasonCode(event.target.value)
                }}
              />
            )}
          </FormField>
        </div>

        <SipMonthLinkField state={sipLink} disabled={locked} />

        <FormField label="Note" hint="Internal. Recorded on the ledger entry, never shown to the investor.">
          {({ id }) => (
            <Input
              id={id}
              value={note}
              maxLength={NOTE_MAX_LENGTH}
              disabled={locked}
              onChange={(event) => {
                setNote(event.target.value)
              }}
            />
          )}
        </FormField>

        {recorded === undefined && !unknown ? (
          <Button
            disabled={locked || incomplete}
            loading={record.pending}
            onClick={() => {
              setConfirmingRecord(true)
            }}
            trailing
          >
            Review and record
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmingRecord && amountPaise !== null}
        title={category.confirmTitle}
        confirmLabel={category.confirmLabel}
        onConfirm={send}
        onCancel={() => {
          setConfirmingRecord(false)
        }}
      >
        <DataList>
          <DetailRow label="Investor">{investorLabel}</DetailRow>
          <DetailRow label="Fund">{funds.nameOf(fundId)}</DetailRow>
          <DetailRow label="Amount" emphasis="lead">
            {amountPaise === null ? null : <MoneyValue amount={amountPaise} size="sm" showDecimals />}
          </DetailRow>
          <DetailRow label="Dated">{effectiveDate === "" ? "" : formatDate(effectiveDate)}</DetailRow>
          <DetailRow label="Category">{category.label}</DetailRow>
          {sipLink.link === null || sipLink.schedule === null ? null : (
            <DetailRow label="SIP month">{sipMonthLabel(sipLink.schedule, sipLink.link.month)}</DetailRow>
          )}
        </DataList>
        <Prose>{category.confirmBody}</Prose>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmingRestart}
        title="Start a new attempt?"
        description="Check this investor's ledger entries first. If this investment is already listed, it was recorded, and a new attempt would record it a second time. A new attempt cannot be matched to the unconfirmed one."
        confirmLabel="Start a new attempt"
        confirmTone="danger"
        cancelLabel="Keep this attempt"
        onConfirm={startNewAttempt}
        onCancel={() => {
          setConfirmingRestart(false)
        }}
      />
    </Card>
  )
}
