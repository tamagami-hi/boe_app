import { useState } from "react"

import { isApiError } from "~/api/errors"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useCreateAdminClient } from "~/features/admin/shared/adminQueries"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"

import { ADMIN_CODE, ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { STACK_LG } from "~/ui/recipes/layout"

const CreateClientScreen = (): React.ReactElement => {
  const create = useCreateAdminClient()
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [failure, setFailure] = useState<string | null>(null)

  const nameLength = Array.from(fullName.trim()).length
  const invalidName = fullName !== "" && (nameLength < 2 || nameLength > 120)
  const invalidPhone = phone !== "" && !/^\+[1-9][0-9]{7,14}$/u.test(phone.replace(/[\s()-]/gu, ""))
  const incomplete =
    fullName.trim() === "" ||
    email.trim() === "" ||
    phone.trim() === "" ||
    invalidName ||
    invalidPhone

  const submit = (): void => {
    setFailure(null)
    create.mutate(
      { fullName: fullName.trim(), email: email.trim(), phone: phone.trim() },
      {
        onError: (error) => {
          setFailure(
            isApiError(error)
              ? error.code === "STATE_CONFLICT"
                ? "That email address or phone number already belongs to an account or an in-flight signup."
                : error.message
              : "We could not create that account. Nothing has changed.",
          )
        },
      },
    )
  }

  return (
    <Page width="default">
      <PageHeader
        title="Create a client account"
        description="Opens an account for someone who never signed up on the website. They choose their own password from an emailed link, and must still verify their email before they can invest."
      />

      {failure === null ? null : (
        <Alert tone="error" title="Nothing created">
          {failure}
        </Alert>
      )}

      {create.data === undefined ? (
        <Card elevated>
          <div className={STACK_LG}>
            <FormField
              label="Full name"
              required
              {...(invalidName ? { error: "Use between 2 and 120 characters." } : {})}
            >
              {({ id }) => (
                <Input
                  id={id}
                  value={fullName}
                  maxLength={120}
                  onChange={(event) => {
                    setFullName(event.target.value)
                  }}
                />
              )}
            </FormField>

            <div className={ADMIN_FORM_GRID}>
              <FormField label="Email" required hint="The invite and all future mail go here.">
                {({ id }) => (
                  <Input
                    id={id}
                    type="email"
                    inputMode="email"
                    value={email}
                    maxLength={254}
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
                {...(invalidPhone ? { error: "Use an international number, starting with +." } : {})}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    maxLength={32}
                    onChange={(event) => {
                      setPhone(event.target.value)
                    }}
                  />
                )}
              </FormField>
            </div>

            <Button disabled={incomplete} loading={create.isPending} onClick={submit} trailing>
              Create the account and email the invite
            </Button>
          </div>
        </Card>
      ) : (
        <Section title="Account created">
          <Card>
            <Alert tone="success" title="The invite has been emailed">
              They set their own password from the link. No password was created here, so nobody
              else knows it.
            </Alert>
            <DataList>
              <DetailRow label="User">
                <span className={ADMIN_CODE}>{create.data.userId}</span>
              </DetailRow>
              <DetailRow label="Account state">{create.data.accountState}</DetailRow>
              <DetailRow label="Email verification">{create.data.emailVerification}</DetailRow>
            </DataList>
            <ButtonLink to={`/users/${create.data.userId}`} tone="secondary" trailing>
              Open this user
            </ButtonLink>
          </Card>
        </Section>
      )}
    </Page>
  )
}

export default CreateClientScreen
