import { useState } from "react"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { useIdempotencyKey } from "~/api/idempotency"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDate } from "~/domain/dates"
import { MoneyFormatError, rupeeTextToPaise, toPaise } from "~/domain/money"
import type { Paise } from "~/domain/money"
import { useRecordClientContribution } from "~/features/admin/shared/adminQueries"
import { useAdminFundCatalogue } from "~/features/admin/shared/queries"
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

const REASON_OPTIONS = [
  { value: "recorded_offline_investment", label: "Investment made before the app" },
  { value: "recorded_offline_correction", label: "Correction to an earlier record" },
] as const

const NOTE_MAX_LENGTH = 2_000

type Outcome =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "rejected"; message: string }>
  | Readonly<{ kind: "unknown" }>

const IDLE: Outcome = { kind: "idle" }

const todayUtc = (): string => new Date().toISOString().slice(0, 10)

const parseAmount = (text: string): Paise | null => {
  if (text === "") return null
  try {
    const paise = rupeeTextToPaise(text)
    return paise === "0" ? null : paise
  } catch (error) {
    if (error instanceof MoneyFormatError) return null
    throw error
  }
}

const describeRejection = (error: unknown): string => {
  if (!isApiError(error)) return "This investment could not be sent. Reload the page and try again."
  if (error.code === "RESOURCE_NOT_FOUND") {
    return "That investor or fund could not be found. Check the selection and try again."
  }
  return error.message
}

const reasonLabel = (value: string): string =>
  REASON_OPTIONS.find((option) => option.value === value)?.label ?? value

export type EarlierInvestmentFormProps = Readonly<{
  userId: string
  investorLabel: string
}>

export const EarlierInvestmentForm = ({
  userId,
  investorLabel,
}: EarlierInvestmentFormProps): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canWrite = hasAnyPermission(["client_position.write"])
  const funds = useAdminFundCatalogue()
  const record = useRecordClientContribution()

  const [fundId, setFundId] = useState("")
  const [rupees, setRupees] = useState("")
  const [effectiveDate, setEffectiveDate] = useState("")
  const [reasonCode, setReasonCode] = useState<string>(REASON_OPTIONS[0].value)
  const [note, setNote] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [outcome, setOutcome] = useState<Outcome>(IDLE)
  const [confirmingRecord, setConfirmingRecord] = useState(false)
  const [confirmingRestart, setConfirmingRestart] = useState(false)

  const amountPaise = parseAmount(rupees)
  const trimmedNote = note.trim()
  const request = {
    userId,
    fundId,
    amountPaise: amountPaise ?? "",
    effectiveDate,
    reasonCode,
    ...(trimmedNote === "" ? {} : { note: trimmedNote }),
  }
  const idempotencyKey = useIdempotencyKey({ ...request, attempt })

  const fundCatalogue = funds.data?.items ?? []
  const fundLabel = (id: string): string => {
    const fund = fundCatalogue.find((entry) => entry.id === id)
    return fund?.name ?? fund?.slug ?? id
  }
  const fundOptions = [
    { value: "", label: "Choose a fund" },
    ...fundCatalogue.map((fund) => ({ value: fund.id, label: fund.name ?? fund.slug })),
  ]

  const recorded = record.data
  const locked = !canWrite || record.isPending || outcome.kind === "unknown" || recorded !== undefined
  const futureDated = effectiveDate !== "" && effectiveDate > todayUtc()
  const amountInvalid = rupees !== "" && amountPaise === null
  const incomplete = fundId === "" || effectiveDate === "" || futureDated || amountPaise === null

  const send = (): void => {
    setConfirmingRecord(false)
    if (amountPaise === null) return
    if (outcome.kind === "rejected") setOutcome(IDLE)
    record.mutate(
      { ...request, amountPaise, idempotencyKey },
      {
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
      },
    )
  }

  const startNewAttempt = (): void => {
    setConfirmingRestart(false)
    setAttempt((current) => current + 1)
    setOutcome(IDLE)
    record.reset()
  }

  const recordAnother = (): void => {
    setFundId("")
    setRupees("")
    setEffectiveDate("")
    setReasonCode(REASON_OPTIONS[0].value)
    setNote("")
    startNewAttempt()
  }

  return (
    <Card elevated>
      <div className={STACK_LG}>
        {canWrite ? null : (
          <Alert tone="info" title="Read only">
            Recording an earlier investment needs the client_position.write permission.
          </Alert>
        )}

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
                <Button size="sm" loading={record.isPending} onClick={send}>
                  Check again
                </Button>
                <Button
                  size="sm"
                  tone="secondary"
                  disabled={record.isPending}
                  onClick={() => {
                    setConfirmingRestart(true)
                  }}
                >
                  Start a new attempt
                </Button>
              </span>
            }
          >
            The reply did not arrive, so it is not known whether this investment was recorded. The
            form is held on this exact request. Check again sends it once more, and the same request
            can only ever be recorded once. It may also already appear in this investor&apos;s ledger
            entries.
          </Alert>
        ) : null}

        {recorded === undefined ? null : (
          <Alert
            tone="success"
            title="Earlier investment recorded"
            action={
              <Button size="sm" tone="secondary" onClick={recordAnother}>
                Record another investment
              </Button>
            }
          >
            The investor has been notified. In this fund they have now invested{" "}
            <MoneyValue amount={toPaise(recorded.principalPaise)} size="sm" showDecimals />, with a
            current value of <MoneyValue amount={toPaise(recorded.currentValuePaise)} size="sm" showDecimals />.
            {recorded.fundVersionEffectiveOnDate
              ? ""
              : " No fund version existed on that date, so the current published version was recorded instead."}
          </Alert>
        )}

        <div className={ADMIN_FORM_GRID}>
          <FormField label="Fund" required>
            {({ id }) => (
              <Select
                id={id}
                options={fundOptions}
                value={fundId}
                disabled={locked}
                onChange={(event) => {
                  setFundId(event.target.value)
                }}
              />
            )}
          </FormField>

          <FormField
            label="Amount in rupees"
            required
            hint="The original amount invested, not including any growth since. Up to two decimal places, for example 250000 or 250000.50."
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
            label="Date of the investment"
            required
            hint="The real date the money was invested. It decides which statement period the entry lands in."
            error={futureDated ? "A past investment cannot be dated in the future." : undefined}
          >
            {({ id }) => (
              <Input
                id={id}
                type="date"
                max={todayUtc()}
                value={effectiveDate}
                disabled={locked}
                onChange={(event) => {
                  setEffectiveDate(event.target.value)
                }}
              />
            )}
          </FormField>

          <FormField label="Reason" required>
            {({ id }) => (
              <Select
                id={id}
                options={REASON_OPTIONS.map((option) => ({ ...option }))}
                value={reasonCode}
                disabled={locked}
                onChange={(event) => {
                  setReasonCode(event.target.value)
                }}
              />
            )}
          </FormField>
        </div>

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

        {recorded === undefined && outcome.kind !== "unknown" ? (
          <Button
            disabled={locked || incomplete}
            loading={record.isPending}
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
        title="Record this earlier investment?"
        confirmLabel="Record the investment"
        onConfirm={send}
        onCancel={() => {
          setConfirmingRecord(false)
        }}
      >
        <DataList>
          <DetailRow label="Investor">{investorLabel}</DetailRow>
          <DetailRow label="Fund">{fundLabel(fundId)}</DetailRow>
          <DetailRow label="Amount" emphasis="lead">
            {amountPaise === null ? null : <MoneyValue amount={amountPaise} size="sm" showDecimals />}
          </DetailRow>
          <DetailRow label="Invested on">{effectiveDate === "" ? "" : formatDate(effectiveDate)}</DetailRow>
          <DetailRow label="Reason">{reasonLabel(reasonCode)}</DetailRow>
        </DataList>
        <Prose>
          This records money the investor already invested before using BeOnEdge. It does not charge
          them or start a payment, and it is not growth: what they invested and its current value
          both rise by this amount. The investor is notified. A mistake is corrected later with a
          reversal, not by editing.
        </Prose>
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
