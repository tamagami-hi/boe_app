import { useState } from "react"
import { useNavigate } from "react-router-dom"

import { ApiError, isApiError, isTransportError } from "~/api/errors"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useToast } from "~/app/providers/ToastProvider"
import { useCreateAdminFund } from "~/features/admin/shared/queries"
import {
  EMPTY_TERMS,
  FundTermsFields,
  SubmitRow,
  useFundTerms,
} from "~/features/admin/funds/FundTermsForm"
import { Alert } from "~/ui/primitives/Feedback"
import { Card } from "~/ui/primitives/Card"
import { FormField, Input } from "~/ui/primitives/FormField"

import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { STACK_LG } from "~/ui/recipes/layout"

const today = (): string => new Date().toISOString().slice(0, 10)

const failureMessage = (error: unknown): string => {
  if (isTransportError(error)) return "We could not reach the backend. Nothing was created."
  if (!isApiError(error)) return "The fund was not created."
  if (error.code === "VALIDATION_FAILED") return error.message
  if (error.code === "STATE_CONFLICT") return "That slug is already in use."
  if (error.code === "AUTHORIZATION_DENIED") {
    return "Creating a fund needs both funds.write and aum.write."
  }
  if (error.code === "RATE_LIMITED") return "Too many AUM writes just now. Wait and retry."
  return "The fund was not created."
}

const FundCreateScreen = (): React.ReactElement => {
  const navigate = useNavigate()
  const toast = useToast()
  const create = useCreateAdminFund()
  const [terms, setTerms] = useFundTerms(EMPTY_TERMS)
  const [slug, setSlug] = useState("")
  const [aumPaise, setAumPaise] = useState("0")
  const [asOfDate, setAsOfDate] = useState(today)
  const [reasonCode, setReasonCode] = useState("initial_aum")
  const [note, setNote] = useState("")

  const fields = create.error instanceof ApiError ? create.error.fields : null

  const submit = (event: { preventDefault: () => void }): void => {
    event.preventDefault()
    create.mutate(
      {
        slug,
        terms: {
          ...terms,
          returnTier: terms.returnTier,
          minimumDurationMonths: terms.minimumDurationMonths,
          recommendedHoldingMonths: terms.recommendedHoldingMonths,
        },
        openingAum: {
          aumPaise,
          asOfDate,
          reasonCode,
          ...(note.trim() === "" ? {} : { note: note.trim() }),
        },
      },
      {
        onSuccess: (data) => {
          toast.show("Fund created and published.")
          void navigate(`/funds/${data.fund.id}`, { replace: true })
        },
      },
    )
  }

  return (
    <Page width="wide">
      <PageHeader
        title="New fund"
        description="One step: this creates the fund, publishes version 1 of its terms, and records the opening AUM. Later changes are new versions and growth entries."
      />

      {create.error === null ? null : (
        <Alert tone="error" title="Not created">
          {failureMessage(create.error)}
        </Alert>
      )}

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
            <FundTermsFields terms={terms} fields={fields} setTerms={setTerms} />
          </Section>
        </Card>

        <Card>
          <Section
            title="Opening AUM"
            description="The absolute fund size at a point in time. Later changes are recorded as growth entries, never edits."
          >
            <div className={ADMIN_FORM_GRID}>
              <FormField label="Opening AUM (paise)" required hint="Integer paise.">
                {({ id, invalid }) => (
                  <Input
                    id={id}
                    required
                    mono
                    inputMode="numeric"
                    value={aumPaise}
                    invalid={invalid}
                    onChange={(event) => {
                      setAumPaise(event.target.value.replace(/[^0-9]/gu, ""))
                    }}
                  />
                )}
              </FormField>

              <FormField label="As of date" required>
                {({ id }) => (
                  <Input
                    id={id}
                    type="date"
                    required
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

        <SubmitRow label="Create fund" pending={create.isPending} />
      </form>
    </Page>
  )
}

export default FundCreateScreen
