import { useState } from "react"
import { useNavigate } from "react-router-dom"

import { ApiError } from "~/api/errors"
import { createAdminFund } from "~/api/generated/operations"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useToast } from "~/app/providers/ToastProvider"
import { formatDate, indiaToday } from "~/domain/dates"
import { tooManyRequestsMessage } from "~/domain/failure"
import { toPaise } from "~/domain/money"
import { paiseToRupeeText, parseRupees } from "~/features/admin/client-values/rupeeAmount"
import { LEAVE_HELD_WRITE } from "~/features/admin/shared/HeldWriteLeaveGuard"
import { useHeldDone } from "~/features/admin/shared/useHeldDone"
import { PersistedHoldNotices, isHeldOrUnreadable } from "~/features/admin/shared/PersistedHoldNotices"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { AmountInput } from "~/ui/primitives/AmountInput"
import { Alert } from "~/ui/primitives/Feedback"
import { Card } from "~/ui/primitives/Card"
import { FormField, Input } from "~/ui/primitives/FormField"

import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { STACK_LG } from "~/ui/recipes/layout"

import { useCreateAdminFund } from "./fundQueries"
import type { CreateFundInput } from "./fundQueries"
import { EMPTY_TERMS, FundTermsFields, SubmitRow, termsBodyOf, termsOfBody } from "./FundTermsForm"
import type { FundTerms } from "./FundTermsForm"

const UNSENT = "The fund could not be sent. Reload the page and try again."

const parseCreateBody = (value: unknown): CreateFundInput | null => {
  const parsed = createAdminFund.request.body.safeParse(value)
  return parsed.success ? parsed.data : null
}

const PERSIST = { slot: "fund-create", parseBody: parseCreateBody, retention: "ordinary" } as const

const rejectionText = (code: string | null, message: string, error: unknown): string => {
  if (code === "STATE_CONFLICT") return "That slug is already in use. Nothing was created."
  if (code === "AUTHORIZATION_DENIED") return "Your role cannot create funds."
  if (code === "RATE_LIMITED") return tooManyRequestsMessage(error instanceof ApiError ? error.retryAfterSeconds : null)
  return message
}

const FundCreateScreen = (): React.ReactElement => {
  const navigate = useNavigate()
  const { show } = useToast()
  const createFund = useCreateAdminFund()
  const create = useHeldWrite(createFund, UNSENT, PERSIST)
  const restored = create.held
  const [terms, setTerms] = useState<FundTerms>(() => (restored === null ? EMPTY_TERMS : termsOfBody(restored.terms)))
  const [slug, setSlug] = useState(() => restored?.slug ?? "")
  const [aumRupees, setAumRupees] = useState(() => (restored === null ? "0" : paiseToRupeeText(restored.openingAum.aumPaise)))
  const [asOfDate, setAsOfDate] = useState(() => restored?.openingAum.asOfDate ?? indiaToday())
  const [reasonCode, setReasonCode] = useState(() => restored?.openingAum.reasonCode ?? "initial_aum")
  const [note, setNote] = useState(() => restored?.openingAum.note ?? "")
  const [isAttempted, setAttempted] = useState(false)
  const [review, setReview] = useState<CreateFundInput | null>(null)

  const { outcome } = create
  const isLocked = isHeldOrUnreadable(create)
  const fields = outcome.kind === "rejected" ? outcome.fields : null
  const aumPaise = parseRupees(aumRupees)
  const termsBody = termsBodyOf(terms)
  const aumError =
    aumPaise === null && (isAttempted || aumRupees !== "")
      ? "Enter the opening AUM in rupees, with at most two decimal places. Zero is allowed."
      : fields?.["openingAum.aumPaise"]?.[0]

  useHeldDone(outcome, (created) => {
    show("Fund created and published.")
    void navigate(`/funds/${created.fund.id}`, { replace: true })
  })

  const submit = (event: { preventDefault: () => void }): void => {
    event.preventDefault()
    setAttempted(true)
    if (aumPaise === null || termsBody === null || isLocked) return
    setReview({
      slug,
      terms: termsBody,
      openingAum: {
        aumPaise,
        asOfDate,
        reasonCode,
        ...(note.trim() === "" ? {} : { note: note.trim() }),
      },
    })
  }

  return (
    <Page width="wide">
      <PageHeader
        title="New fund"
        description="One step: this creates the fund, publishes version 1 of its terms, and records the opening AUM. Later changes are new versions and growth entries."
      />

      <PersistedHoldNotices
        write={create}
        subject="the fund was created"
        onReload={() => {
          void navigate("/funds", { state: LEAVE_HELD_WRITE })
        }}
        reloadLabel="Check the fund list"
        restartWarning="Check the fund list first. If a fund with this slug is listed, it was created, and a new attempt will be refused for that slug. A new attempt cannot be matched to the unconfirmed one."
      />
      {outcome.kind === "rejected" ? (
        <Alert tone="error" title="Not created">
          {rejectionText(outcome.code, outcome.message, createFund.error)}
        </Alert>
      ) : null}

      {isAttempted && (aumPaise === null || termsBody === null) ? (
        <Alert tone="error" title="Check the form">
          Nothing was sent. Choose a risk level, and enter every amount in rupees with at most two decimal places.
        </Alert>
      ) : null}

      <form onSubmit={submit} noValidate className={STACK_LG}>
        <Card>
          <Section title="Identity">
            <FormField
              label="Slug"
              required
              hint="Lower-case words separated by hyphens. This is permanent."
              {...(fields?.slug?.[0] === undefined ? {} : { error: fields.slug[0] })}
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  required
                  mono
                  disabled={isLocked}
                  value={slug}
                  invalid={invalid}
                  {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
                  onChange={(event) => {
                    setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/gu, ""))
                  }}
                />
              )}
            </FormField>
          </Section>
        </Card>

        <Card>
          <Section title="Terms">
            <FundTermsFields terms={terms} fields={fields} setTerms={setTerms} disabled={isLocked} isAttempted={isAttempted} />
          </Section>
        </Card>

        <Card>
          <Section
            title="Opening AUM"
            description="The absolute fund size at a point in time. Later changes are recorded as growth entries, never edits."
          >
            <div className={ADMIN_FORM_GRID}>
              <FormField label="Opening AUM" required hint="In rupees, up to two decimal places." error={aumError}>
                {({ id, describedBy, invalid }) => (
                  <AmountInput
                    id={id}
                    decimals
                    disabled={isLocked}
                    value={aumRupees}
                    invalid={invalid}
                    describedBy={describedBy}
                    onChange={setAumRupees}
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

              <FormField label="Reason code" required hint="Recorded in the audit trail.">
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

              <FormField label="Note" hint="Optional context for the audit trail.">
                {({ id }) => (
                  <Input
                    id={id}
                    disabled={isLocked}
                    value={note}
                    onChange={(event) => {
                      setNote(event.target.value)
                    }}
                  />
                )}
              </FormField>
            </div>
          </Section>
        </Card>

        <SubmitRow label="Review the new fund" pending={create.pending} disabled={isLocked} />
      </form>

      <ConfirmDialog
        open={review !== null}
        title={`Create ${review?.terms.name ?? "this fund"}?`}
        description="This creates the fund, publishes version 1 of its terms to investors and records the opening AUM below. Later changes are new versions and growth entries, never edits."
        confirmLabel="Create the fund"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (review === null) return
          setReview(null)
          create.submit(review)
        }}
        onCancel={() => {
          setReview(null)
        }}
      >
        {review === null ? null : (
          <DataList>
            <DetailRow label="Slug">{review.slug}</DetailRow>
            <DetailRow label="Opening AUM" emphasis="lead">
              <MoneyValue amount={toPaise(review.openingAum.aumPaise)} size="sm" showDecimals />
            </DetailRow>
            <DetailRow label="As of">{formatDate(`${review.openingAum.asOfDate}T00:00:00Z`)}</DetailRow>
            <DetailRow label="Reason code">{review.openingAum.reasonCode}</DetailRow>
          </DataList>
        )}
      </ConfirmDialog>
    </Page>
  )
}

export default FundCreateScreen
