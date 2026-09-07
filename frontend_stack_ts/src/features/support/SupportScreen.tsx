import { useState } from "react"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { isApiError } from "~/api/errors"
import { formatDateTime } from "~/domain/dates"
import { supportRequestState } from "~/domain/status"
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
import { FormField, Input } from "~/ui/primitives/FormField"
import { Select } from "~/ui/primitives/Select"
import { Textarea } from "~/ui/primitives/Textarea"
import { ITEM_TITLE, PROSE_PRE, PROSE_SM } from "~/ui/recipes/datalist"
import { CARD_COLUMNS, FIELD_MEASURE, ROW_BETWEEN, STACK_LG } from "~/ui/recipes/layout"
import { CARD_STACK, INSET_NOTE } from "~/ui/recipes/surface"
import { META_ROW, REFERENCE_TEXT } from "~/ui/recipes/text"

import { TICKET_COUNTER } from "./support.recipe"

const TICKET_BODY = cx(PROSE_SM, PROSE_PRE)

const MAX_SUBJECT = 200
const MAX_BODY = 5_000

const CATEGORIES = [
  { value: "general", label: "General question" },
  { value: "payments", label: "A payment or refund" },
  { value: "sip", label: "A SIP or AutoPay" },
  { value: "account", label: "My account or sign-in" },
  { value: "statement", label: "Statements and values" },
] as const

const categoryLabel = (value: string): string | null =>
  CATEGORIES.find((category) => category.value === value)?.label ?? null

const SupportScreen = (): React.ReactElement => {
  const faqs = useSupportFaqs()
  const tickets = useSupportTickets()
  const create = useCreateSupportTicket()

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

      <Section title="Raise a request">
        <Card elevated>
          <div className={cx(STACK_LG, FIELD_MEASURE)}>
            {create.isSuccess && subject === "" && body === "" ? (
              <Alert tone="success" title="Message sent">
                We reply by email. You can follow it below.
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
                  options={CATEGORIES}
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
              hint="Include amounts, dates and any reference you already have."
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

            {bodyTrimmed.length === 0 ? null : (
              <span className={TICKET_COUNTER}>
                {`${String(MAX_BODY - bodyTrimmed.length)} characters left`}
              </span>
            )}

            <Button loading={create.isPending} onClick={submit} trailing>
              Send request
            </Button>
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
              description="Messages you send appear here, along with our reply."
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
                    {categoryLabel(ticket.category) === null ? null : (
                      <span>{categoryLabel(ticket.category)}</span>
                    )}
                    {ticket.resolvedAt === null ? null : (
                      <span>Resolved {formatDateTime(ticket.resolvedAt)}</span>
                    )}
                  </div>
                  {ticket.resolutionNote === null ? null : (
                    <div className={INSET_NOTE}>{ticket.resolutionNote}</div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </AsyncBoundary>
        <LoadMore list={tickets} noun="requests" />
      </Section>

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
    </Page>
  )
}

export default SupportScreen
