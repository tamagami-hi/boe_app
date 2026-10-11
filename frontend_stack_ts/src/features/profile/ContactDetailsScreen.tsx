import { useState } from "react"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { clientEmailVerification } from "~/domain/clientStatus"
import { describeClientFailure } from "~/domain/failure"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { Form } from "~/ui/primitives/Form"
import { FormField, Input } from "~/ui/primitives/FormField"
import { HONESTY_TEXT } from "~/ui/recipes/text"

import { useChangeClientPhone, useClientProfile } from "./profileQueries"

const E164 = /^\+[1-9][0-9]{7,14}$/u
const SEPARATORS = /[\s()-]/gu

const ContactDetailsScreen = (): React.ReactElement => {
  const profile = useClientProfile()
  const change = useChangeClientPhone()
  const [phone, setPhone] = useState("")
  const [currentPassword, setCurrentPassword] = useState("")
  const [failure, setFailure] = useState<unknown>(null)
  const [result, setResult] = useState<"changed" | "unchanged" | null>(null)

  const compact = phone.replace(SEPARATORS, "")
  const invalidPhone = phone !== "" && !E164.test(compact)
  const ready = E164.test(compact) && currentPassword !== ""

  const submit = (): void => {
    setFailure(null)
    setResult(null)
    change.mutate(
      { phone: phone.trim(), currentPassword },
      {
        onSuccess: (outcome) => {
          setResult(outcome.status)
          setPhone("")
          setCurrentPassword("")
        },
        onError: (cause) => {
          setFailure(cause)
          setCurrentPassword("")
        },
      },
    )
  }

  return (
    <Page width="default">
      <PageHeader
        title="Contact details"
        description="The email address and phone number on your BeOnEdge account."
      />

      <AsyncBoundary query={profile} skeleton={<Skeleton height="4rem" />}>
        {(data) => (
          <Card elevated>
            <DataList split>
              <DetailRow label="Email">{data.email}</DetailRow>
              <DetailRow label="Email status">
                <StatusBadge status={clientEmailVerification(data.emailVerification)} />
              </DetailRow>
              <DetailRow label="Phone">{data.phone}</DetailRow>
              <DetailRow label="Phone status">Not verified by SMS</DetailRow>
            </DataList>
          </Card>
        )}
      </AsyncBoundary>

      <Section
        title="Change your phone number"
        description="Confirm with your current password. We email you to say the number changed."
      >
        <Card elevated>
          <p className={HONESTY_TEXT}>
            BeOnEdge does not send a code to the new number, so it is shown as not verified. Make sure
            you type it correctly.
          </p>

          {result === "changed" ? (
            <Alert tone="success" title="Phone number changed">
              Your new number is saved. We have emailed you about the change.
            </Alert>
          ) : null}
          {result === "unchanged" ? (
            <Alert tone="info" title="Nothing to change">
              That is already the number on your account.
            </Alert>
          ) : null}
          {failure === null ? null : (
            <Alert tone="error" title={describeClientFailure(failure, "changePhone").title}>
              {describeClientFailure(failure, "changePhone").message}
            </Alert>
          )}

          <Form
            onSubmit={() => {
              submit()
            }}
            actions={
              <Button type="submit" disabled={!ready} loading={change.isPending} trailing>
                Change my phone number
              </Button>
            }
          >
            <FormField
              label="New phone number"
              required
              hint="With the country code, for example +919876543210."
              error={invalidPhone ? "Use an international number, starting with +." : undefined}
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={32}
                  required
                  value={phone}
                  invalid={invalid}
                  {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
                  onChange={(event) => {
                    setPhone(event.target.value)
                  }}
                />
              )}
            </FormField>

            <FormField label="Current password" required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  name="current-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  invalid={invalid}
                  {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
                  onChange={(event) => {
                    setCurrentPassword(event.target.value)
                  }}
                />
              )}
            </FormField>
          </Form>
        </Card>
      </Section>
    </Page>
  )
}

export default ContactDetailsScreen
