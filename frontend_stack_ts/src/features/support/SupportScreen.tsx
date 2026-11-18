import { useState } from "react"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { isApiError } from "~/api/errors"
import { formatDateTime } from "~/domain/dates"
import { supportRequestState } from "~/domain/status"
import { SUPPORT_CATEGORIES, supportCategoryLabel } from "~/domain/supportCategories"
import { SupportContacts, useSupportContacts } from "~/features/legal/SupportContacts"
import type { LegalContact } from "~/features/legal/publishedContent"
import {
  useCreateSupportTicket,
  useSupportFaqs,
  useSupportTickets,
} from "~/features/shared/queries"
import { cx } from "~/lib/cx"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { Disclosure, Prose } from "~/ui/patterns/DataList"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { Form } from "~/ui/primitives/Form"
import { FormField, Input } from "~/ui/primitives/FormField"
import { Select } from "~/ui/primitives/Select"
import { Textarea } from "~/ui/primitives/Textarea"
import { ITEM_TITLE, PROSE_PRE, PROSE_SM } from "~/ui/recipes/datalist"
import { CARD_COLUMNS, FIELD_MEASURE, ROW_BETWEEN } from "~/ui/recipes/layout"
import { CARD_STACK, INSET_NOTE } from "~/ui/recipes/surface"
import { META_ROW, REFERENCE_TEXT } from "~/ui/recipes/text"

const TICKET_BODY = cx(PROSE_SM, PROSE_PRE)

const MAX_SUBJECT = 200
const MAX_BODY = 5_000

const CONTACTS_TITLE = "Contact the BeOnEdge team"

const CONTACTS_UNPUBLISHED =
  "No contact details are listed here yet. Requests you send here reach the BeOnEdge team."

const PHONE_CHARACTERS = /^\+?[0-9\s().-]+$/u

const MIN_PHONE_DIGITS = 10

const digitCount = (text: string): number => text.replace(/[^0-9]/gu, "").length

const isPhone = (contact: LegalContact): boolean =>
  contact.href?.toLowerCase().startsWith("tel:") === true ||
  contact.label === "Phone" ||
  (PHONE_CHARACTERS.test(contact.value) && digitCount(contact.value) >= MIN_PHONE_DIGITS)

const isNotPhone = (contact: LegalContact): boolean => !isPhone(contact)

const SupportScreen = (): React.ReactElement => {
  const faqs = useSupportFaqs()
  const tickets = useSupportTickets()
  const create = useCreateSupportTicket()
  const hasContacts = useSupportContacts(isNotPhone).length > 0

  const [category, setCategory] = useState<string>("general")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [submitted, setSubmitted] = useState(false)

  const subjectTrimmed = subject.trim()
  const bodyTrimmed = body.trim()
  const subjectError =
    subjectTrimmed === "" ? "Tell us in one line what this is about." : undefined
  const bodyError = bodyTrimmed === "" ? "Describe what happened so we can look into it." : undefined
  const canSubmit = subjectError === undefined && bodyError === undefined && !create.isPending

  const failure = create.error
  const failureMessage =
    failure === null
      ? null
      : isApiError(failure)
        ? failure.message
        : "We could not send your request. Nothing was sent \u2014 please try again."

  const submit = (): void => {
    setSubmitted(true)
    if (!canSubmit) return
    create.mutate(
      { subject: subjectTrimmed, body: bodyTrimmed, category },
      {
        onSuccess: () => {
          setSubject("")
          setBody("")
          setSubmitted(false)
        },
      },
    )
  }

  return (
    <Page width="default">
      <PageHeader
        title="Support"
        description="Find an answer below, or send us a message."
      />

      <Section title="Published answers">
        <AsyncBoundary
          query={faqs}
          skeleton={
            <Card>
              <Skeleton height="1rem" width="60%" />
              <Skeleton height="1rem" width="45%" />
            </Card>
          }
          isEmpty={(data) => data.items.length === 0}
          empty={
            <EmptyState
              title="No answers yet"
              description="Answers to common questions will appear here."
            />
          }
        >
          {(data) => (
            <Card>
              <div className="flex flex-col">
                {data.items.map((faq) => (
                  <Disclosure key={`${faq.key}-${String(faq.version)}`} title={faq.q}>
                    <Prose>{faq.a}</Prose>
                  </Disclosure>
                ))}
              </div>
            </Card>
          )}
        </AsyncBoundary>
      </Section>

      <Section title="Raise a request">
        <Card elevated>
          <div className={FIELD_MEASURE}>
            <Form
              onSubmit={submit}
              actions={
                <Button type="submit" loading={create.isPending} trailing>
                  Send request
                </Button>
              }
            >
              {create.isSuccess && subject === "" && body === "" ? (
                <Alert tone="success" title="Request sent">
                  {hasContacts
                    ? `The BeOnEdge team will review it, and its status below will update. For anything urgent, use the contact details under ${CONTACTS_TITLE}.`
                    : "The BeOnEdge team will review it, and its status below will update."}
                </Alert>
              ) : null}
              {failureMessage === null ? null : (
                <Alert tone="error" title="That did not send">
                  {failureMessage}
                </Alert>
              )}

              <FormField label="What is it about" required>
                {({ id }) => (
                  <Select
                    id={id}
                    options={SUPPORT_CATEGORIES}
                    value={category}
                    onChange={(event) => {
                      setCategory(event.target.value)
                    }}
                  />
                )}
              </FormField>

              <FormField
                label="Subject"
                required
                {...(submitted && subjectError !== undefined ? { error: subjectError } : {})}
              >
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    maxLength={MAX_SUBJECT}
                    value={subject}
                    onChange={(event) => {
                      setSubject(event.target.value)
                    }}
                  />
                )}
              </FormField>

              <FormField
                label="What happened"
                hint={
                  bodyTrimmed.length === 0
                    ? "Include amounts, dates and any reference you already have."
                    : `${String(MAX_BODY - bodyTrimmed.length)} characters left`
                }
                required
                {...(submitted && bodyError !== undefined ? { error: bodyError } : {})}
              >
                {({ id, describedBy, invalid }) => (
                  <Textarea
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    maxLength={MAX_BODY}
                    value={body}
                    onChange={(event) => {
                      setBody(event.target.value)
                    }}
                  />
                )}
              </FormField>
            </Form>
          </div>
        </Card>
      </Section>

      <Section title="Your requests">
        <AsyncBoundary
          query={tickets}
          skeleton={
            <Card>
              <Skeleton height="1rem" width="50%" />
              <Skeleton height="0.85rem" width="75%" />
            </Card>
          }
          isEmpty={(data) => data.items.length === 0}
          empty={
            <EmptyState
              title="No requests yet"
              description="Requests you send appear here with their current status."
            />
          }
        >
          {(data) => (
            <div className={cx(CARD_STACK, CARD_COLUMNS[2])}>
              {data.items.map((ticket) => (
                <Card key={ticket.id}>
                  <div className={ROW_BETWEEN}>
                    <span className={ITEM_TITLE}>{ticket.subject}</span>
                    <StatusBadge status={supportRequestState(ticket.status)} />
                  </div>
                  <span className={REFERENCE_TEXT}>{ticket.reference}</span>
                  <p className={TICKET_BODY}>{ticket.body}</p>
                  <div className={META_ROW}>
                    <span>Raised {formatDateTime(ticket.createdAt)}</span>
                    {supportCategoryLabel(ticket.category) === null ? null : (
                      <span>{supportCategoryLabel(ticket.category)}</span>
                    )}
                    {ticket.resolvedAt === null ? null : (
                      <span>Resolved {formatDateTime(ticket.resolvedAt)}</span>
                    )}
                  </div>
                  {ticket.resolutionNote === null ? null : (
                    <div className={INSET_NOTE}>{`Reply from the BeOnEdge team: ${ticket.resolutionNote}`}</div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </AsyncBoundary>
        <LoadMore list={tickets} noun="requests" />
      </Section>

      <Section title={CONTACTS_TITLE}>
        <Card>
          <SupportContacts unpublished={CONTACTS_UNPUBLISHED} pick={isNotPhone} />
        </Card>
      </Section>
    </Page>
  )
}

export default SupportScreen
