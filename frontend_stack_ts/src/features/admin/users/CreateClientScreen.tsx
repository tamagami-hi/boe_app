import { useState } from "react"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { useIdempotencyKey } from "~/api/idempotency"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { EarlierInvestmentForm } from "~/features/admin/client-values/EarlierInvestmentForm"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"

import { ADMIN_CODE, ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

import {
  fieldRefusals,
  nameProblem,
  normalizedPhone,
  phoneProblem,
  refusalFor,
  type ClientContact,
  type FieldRefusals,
} from "./clientContact"
import { useCreateAdminClient } from "./createClientQueries"
import { PasswordLinkPanel } from "./PasswordLinkPanel"

type Outcome =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "rejected"; message: string; conflict: boolean; refusals: FieldRefusals }>
  | Readonly<{ kind: "unknown"; serverMessage: string | null }>

type Step = "edit" | "review"

const IDLE: Outcome = { kind: "idle" }

const NO_REFUSALS: FieldRefusals = {}

const PURPOSE_LABEL = { set: "Set a first password", reset: "Reset the password" } as const

const directoryLink = (email: string): string => `/users?q=${encodeURIComponent(email)}`

const describeRejection = (error: unknown, submitted: ClientContact): Outcome => {
  if (!isApiError(error)) {
    return {
      kind: "rejected",
      message: "The request could not be sent. Reload the page and try again.",
      conflict: false,
      refusals: NO_REFUSALS,
    }
  }
  const refusals = fieldRefusals(error, submitted)
  if (error.code === "STATE_CONFLICT") {
    return {
      kind: "rejected",
      message:
        "That email address or phone number already belongs to an account or a signup in progress. If an earlier attempt may have created this account, find it in the directory before trying again.",
      conflict: true,
      refusals,
    }
  }
  return { kind: "rejected", message: error.message, conflict: false, refusals }
}

const CreateClientScreen = (): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canRecordInvestment = hasAnyPermission(["client_position.write"])
  const create = useCreateAdminClient()
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [step, setStep] = useState<Step>("edit")
  const [outcome, setOutcome] = useState<Outcome>(IDLE)
  const [confirmingRestart, setConfirmingRestart] = useState(false)

  const request: ClientContact = { fullName: fullName.trim(), email: email.trim(), phone: phone.trim() }
  const idempotencyKey = useIdempotencyKey({ ...request, attempt })
  const created = create.data
  const locked = create.isPending || outcome.kind === "unknown" || step === "review"
  const refusals = outcome.kind === "rejected" ? outcome.refusals : NO_REFUSALS

  const nameError = nameProblem(request.fullName) ?? refusalFor(refusals, "fullName", request)
  const emailError = refusalFor(refusals, "email", request)
  const phoneError = phoneProblem(request.phone) ?? refusalFor(refusals, "phone", request)
  const incomplete =
    request.fullName === "" ||
    request.email === "" ||
    request.phone === "" ||
    nameProblem(request.fullName) !== null ||
    phoneProblem(request.phone) !== null

  const submit = (): void => {
    if (outcome.kind === "rejected") setOutcome(IDLE)
    create.mutate(
      { ...request, idempotencyKey },
      {
        onSuccess: () => {
          setOutcome(IDLE)
        },
        onError: (error) => {
          if (isUnknownWriteOutcome(error)) {
            setOutcome({ kind: "unknown", serverMessage: isApiError(error) ? error.message : null })
            return
          }
          setOutcome(describeRejection(error, request))
          setStep("edit")
        },
      },
    )
  }

  const startNewAttempt = (): void => {
    setConfirmingRestart(false)
    setAttempt((current) => current + 1)
    setOutcome(IDLE)
    setStep("edit")
    create.reset()
  }

  const createAnother = (): void => {
    setFullName("")
    setEmail("")
    setPhone("")
    startNewAttempt()
  }

  return (
    <Page width="default">
      <PageHeader
        title="Create a client account"
        description="Opens an account for someone who never signed up on the website. They choose their own password from an emailed link, and must still verify their email before they can invest."
      />

      {outcome.kind === "rejected" ? (
        <Alert
          tone="error"
          title="Not created"
          {...(outcome.conflict
            ? {
                action: (
                  <ButtonLink to={directoryLink(request.email)} tone="secondary" size="sm">
                    Find the account
                  </ButtonLink>
                ),
              }
            : {})}
        >
          {outcome.message}
        </Alert>
      ) : null}

      {outcome.kind === "unknown" ? (
        <Alert
          tone="warning"
          title="Not confirmed"
          action={
            <span className={ACTION_ROW}>
              <Button size="sm" loading={create.isPending} onClick={submit}>
                Check again
              </Button>
              <ButtonLink to={directoryLink(request.email)} tone="secondary" size="sm">
                Find the account
              </ButtonLink>
              <Button
                size="sm"
                tone="ghost"
                disabled={create.isPending}
                onClick={() => {
                  setConfirmingRestart(true)
                }}
              >
                Start a new attempt
              </Button>
            </span>
          }
        >
          {`The reply did not arrive, so it is not known whether the account was created. The form is held on this exact request. Check again repeats it: if the account was created you get it back, even days later, and no second account is made. ${outcome.serverMessage ?? ""}`.trim()}
        </Alert>
      ) : null}

      {created === undefined ? (
        <Card elevated>
          <div className={STACK_LG}>
            <FormField label="Full name" required error={nameError}>
              {({ id }) => (
                <Input
                  id={id}
                  value={fullName}
                  maxLength={120}
                  disabled={locked}
                  onChange={(event) => {
                    setFullName(event.target.value)
                  }}
                />
              )}
            </FormField>

            <div className={ADMIN_FORM_GRID}>
              <FormField label="Email" required hint="The password link and all future mail go here." error={emailError}>
                {({ id }) => (
                  <Input
                    id={id}
                    type="email"
                    inputMode="email"
                    value={email}
                    maxLength={254}
                    disabled={locked}
                    onChange={(event) => {
                      setEmail(event.target.value)
                    }}
                  />
                )}
              </FormField>

              <FormField
                label="Phone"
                required
                hint="With the country code, for example +919876543210."
                error={phoneError}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    maxLength={32}
                    disabled={locked}
                    onChange={(event) => {
                      setPhone(event.target.value)
                    }}
                  />
                )}
              </FormField>
            </div>

            {step === "review" ? (
              <>
                <Alert tone="info" title="Check these details before creating the account">
                  The password link is emailed to this address as soon as the account is created.
                </Alert>
                <DataList>
                  <DetailRow label="Full name">{request.fullName}</DetailRow>
                  <DetailRow label="Email">
                    <span className={ADMIN_CODE}>{request.email}</span>
                  </DetailRow>
                  <DetailRow label="Phone">
                    <span className={ADMIN_CODE}>{normalizedPhone(request.phone)}</span>
                  </DetailRow>
                </DataList>
                {outcome.kind === "unknown" ? null : (
                  <div className={ACTION_ROW}>
                    <Button loading={create.isPending} onClick={submit} trailing>
                      Create the account and queue the password link
                    </Button>
                    <Button
                      tone="ghost"
                      disabled={create.isPending}
                      onClick={() => {
                        setStep("edit")
                      }}
                    >
                      Change the details
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className={PROSE_SM}>Nothing is created or emailed until you confirm the details on the next step.</p>
                <Button
                  disabled={locked || incomplete}
                  onClick={() => {
                    setStep("review")
                  }}
                  trailing
                >
                  Review the details
                </Button>
              </>
            )}
          </div>
        </Card>
      ) : (
        <>
          <Section title="Account created">
            <Card>
              <Alert tone="success" title="Account created">
                {`The password link is queued for ${request.email}. They choose their own password from it, so nobody else knows it.`}
              </Alert>
              <DataList>
                <DetailRow label="User">
                  <span className={ADMIN_CODE}>{created.userId}</span>
                </DetailRow>
                <DetailRow label="Account state">{created.accountState}</DetailRow>
                <DetailRow label="Email verification">{created.emailVerification}</DetailRow>
                {created.passwordLink === undefined ? null : (
                  <DetailRow label="Password link">
                    {`${PURPOSE_LABEL[created.passwordLink.purpose]}, queued, expires ${formatDateTime(created.passwordLink.expiresAt)}`}
                  </DetailRow>
                )}
              </DataList>
              <div className={ACTION_ROW}>
                <ButtonLink to={`/users/${created.userId}`} tone="secondary" trailing>
                  Open this user
                </ButtonLink>
                <Button tone="ghost" onClick={createAnother}>
                  Create another client
                </Button>
              </div>
            </Card>
          </Section>

          <Section
            title="Password link"
            description="Shows whether the link went out. If it did not arrive, send a new one; it replaces the earlier link."
          >
            <PasswordLinkPanel userId={created.userId} email={request.email} canReceive />
          </Section>

          {canRecordInvestment ? (
            <Section
              title="Record an investment"
              description="Optional. Records money this client has already paid to BeOnEdge, one fund at a time. It is not a charge and not growth."
            >
              <EarlierInvestmentForm userId={created.userId} investorLabel={request.fullName} />
            </Section>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={confirmingRestart}
        title="Start a new attempt?"
        description="Find the account in the directory first. If it already exists, the earlier attempt created it, and a new attempt will be refused or would need a different email and phone. A new attempt cannot be matched to the unconfirmed one."
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

export default CreateClientScreen
