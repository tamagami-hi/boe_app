import { useState } from "react"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { mintIdempotencyKey } from "~/api/idempotency"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"

import { ADMIN_CODE, ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

import {
  fieldRefusals,
  normalizedPhone,
  phoneProblem,
  refusalFor,
  type ClientContact,
  type FieldRefusals,
} from "./clientContact"
import { useCorrectClientContacts, type ContactCorrectionInput, type CorrectedContacts } from "./contactQueries"

type CorrectionBody = Omit<ContactCorrectionInput, "idempotencyKey">

type Held = Readonly<{ body: CorrectionBody; submitted: ClientContact; idempotencyKey: string }>

type Outcome =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "rejected"; message: string; refusals: FieldRefusals; reloadable: boolean }>
  | Readonly<{ kind: "unknown"; serverMessage: string | null }>

const IDLE: Outcome = { kind: "idle" }

const NO_REFUSALS: FieldRefusals = {}

const describeRejection = (error: unknown, submitted: ClientContact): Outcome => {
  if (!isApiError(error)) {
    return {
      kind: "rejected",
      message: "The request could not be sent. Reload the page and try again.",
      refusals: NO_REFUSALS,
      reloadable: false,
    }
  }
  const refusals = fieldRefusals(error, submitted)
  if (error.code === "STATE_CONFLICT" && Object.keys(refusals).length > 0) {
    return {
      kind: "rejected",
      message:
        "That email address or phone number already belongs to another account or a signup in progress. If it belongs to a closed account, release that account's email and phone first.",
      refusals,
      reloadable: false,
    }
  }
  return { kind: "rejected", message: error.message, refusals, reloadable: error.code === "STATE_CONFLICT" }
}

export type ContactCorrectionFormProps = Readonly<{
  userId: string
  email: string
  phone: string
  version: number
  reloading: boolean
  onReload: () => Promise<boolean>
  onCorrected: (result: CorrectedContacts) => void
}>

export const ContactCorrectionForm = ({
  userId,
  email,
  phone,
  version,
  reloading,
  onReload,
  onCorrected,
}: ContactCorrectionFormProps): React.ReactElement => {
  const correct = useCorrectClientContacts(userId)
  const [emailInput, setEmailInput] = useState(email)
  const [phoneInput, setPhoneInput] = useState(phone)
  const [reviewing, setReviewing] = useState(false)
  const [held, setHeld] = useState<Held | null>(null)
  const [outcome, setOutcome] = useState<Outcome>(IDLE)

  const typed: ClientContact = { fullName: "", email: emailInput.trim(), phone: phoneInput.trim() }
  const emailChanged = typed.email !== "" && typed.email.toLowerCase() !== email
  const phoneChanged = typed.phone !== "" && normalizedPhone(typed.phone) !== phone
  const unknown = outcome.kind === "unknown"
  const locked = correct.isPending || unknown || reviewing
  const refusals = outcome.kind === "rejected" ? outcome.refusals : NO_REFUSALS
  const emailError = refusalFor(refusals, "email", typed)
  const phoneError = phoneProblem(typed.phone) ?? refusalFor(refusals, "phone", typed)
  const ready =
    (emailChanged || phoneChanged) && typed.email !== "" && typed.phone !== "" && phoneProblem(typed.phone) === null

  const send = (attempt: Held): void => {
    setHeld(attempt)
    if (outcome.kind === "rejected") setOutcome(IDLE)
    correct.mutate(
      { ...attempt.body, idempotencyKey: attempt.idempotencyKey },
      {
        onSuccess: (result) => {
          setHeld(null)
          setOutcome(IDLE)
          setReviewing(false)
          onCorrected(result)
        },
        onError: (error) => {
          if (isUnknownWriteOutcome(error)) {
            setOutcome({ kind: "unknown", serverMessage: isApiError(error) ? error.message : null })
            return
          }
          setHeld(null)
          setReviewing(false)
          setOutcome(describeRejection(error, attempt.submitted))
        },
      },
    )
  }

  const submit = (): void => {
    send({
      body: {
        ...(emailChanged ? { email: typed.email } : {}),
        ...(phoneChanged ? { phone: typed.phone } : {}),
        expectedVersion: version,
      },
      submitted: typed,
      idempotencyKey: mintIdempotencyKey(),
    })
  }

  const reload = async (): Promise<void> => {
    if (await onReload()) {
      setHeld(null)
      setOutcome(IDLE)
      setReviewing(false)
    }
  }

  const reloadButton = (
    <Button
      size="sm"
      tone="ghost"
      disabled={correct.isPending}
      loading={reloading}
      onClick={() => {
        void reload()
      }}
    >
      Reload the account
    </Button>
  )

  return (
    <div className={STACK_LG}>
      {outcome.kind === "rejected" ? (
        <Alert tone="error" title="Nothing changed" {...(outcome.reloadable ? { action: reloadButton } : {})}>
          {outcome.message}
        </Alert>
      ) : null}
      {unknown && held !== null ? (
        <Alert
          tone="warning"
          title="Not confirmed"
          action={
            <span className={ACTION_ROW}>
              <Button
                size="sm"
                loading={correct.isPending}
                onClick={() => {
                  send(held)
                }}
              >
                Check again
              </Button>
              {reloadButton}
            </span>
          }
        >
          {`The reply did not arrive, so it is not known whether the correction was saved or a new invite queued. Check again repeats the same request and cannot apply it twice. Reload the account to see the email and phone it holds now; any change after that is a new request. ${outcome.serverMessage ?? ""}`.trim()}
        </Alert>
      ) : null}

      <div className={ADMIN_FORM_GRID}>
        <FormField label="Email" required hint="The new invite link goes to this address." error={emailError}>
          {({ id }) => (
            <Input
              id={id}
              type="email"
              inputMode="email"
              value={emailInput}
              maxLength={254}
              disabled={locked}
              onChange={(event) => {
                setEmailInput(event.target.value)
              }}
            />
          )}
        </FormField>
        <FormField label="Phone" required hint="With the country code, for example +919876543210." error={phoneError}>
          {({ id }) => (
            <Input
              id={id}
              type="tel"
              inputMode="tel"
              value={phoneInput}
              maxLength={32}
              disabled={locked}
              onChange={(event) => {
                setPhoneInput(event.target.value)
              }}
            />
          )}
        </FormField>
      </div>

      {reviewing ? (
        <>
          <Alert tone="info" title="Check the correction">
            {emailChanged
              ? "A new invite link is emailed to the corrected address as soon as you confirm, and every earlier link stops working. Nothing is sent to the old address."
              : "Only the phone number changes. No email is sent and the current invite link keeps working."}
          </Alert>
          <DataList>
            {emailChanged ? (
              <DetailRow label="Email">
                <span className={ADMIN_CODE}>{`${email} to ${typed.email.toLowerCase()}`}</span>
              </DetailRow>
            ) : null}
            {phoneChanged ? (
              <DetailRow label="Phone">
                <span className={ADMIN_CODE}>{`${phone} to ${normalizedPhone(typed.phone)}`}</span>
              </DetailRow>
            ) : null}
          </DataList>
          {unknown ? null : (
            <div className={ACTION_ROW}>
              <Button loading={correct.isPending} onClick={submit} trailing>
                {emailChanged ? "Correct and send the new invite" : "Correct the phone number"}
              </Button>
              <Button
                tone="ghost"
                disabled={correct.isPending}
                onClick={() => {
                  setReviewing(false)
                }}
              >
                Change the details
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className={PROSE_SM}>Nothing is saved or emailed until you confirm the correction on the next step.</p>
          <div className={ACTION_ROW}>
            <Button
              disabled={locked || !ready}
              onClick={() => {
                setReviewing(true)
              }}
              trailing
            >
              Review the correction
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
