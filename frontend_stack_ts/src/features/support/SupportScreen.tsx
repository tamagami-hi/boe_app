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
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { Disclosure, Prose } from "~/ui/patterns/DataList"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { Select } from "~/ui/primitives/Select"
import { Textarea } from "~/ui/primitives/Textarea"

import styles from "./Support.module.css"

const MAX_SUBJECT = 200
const MAX_BODY = 5_000

const CATEGORIES = [
  { value: "general", label: "General question" },
  { value: "payments", label: "A payment or refund" },
  { value: "sip", label: "A SIP or mandate" },
  { value: "account", label: "My account or sign-in" },
  { value: "statement", label: "Statements and values" },
] as const

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
        : "We could not send that. Nothing was recorded — try again."

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
        description="Read the published answers first, then raise a request. Every request gets a reference you can quote."
      />

      <Section title="Raise a request">
        <Card elevated>
          <div className={styles.form}>
            {create.isSuccess && subject === "" && body === "" ? (
              <Alert tone="success" title="We have your request">
                It appears below with its reference. We reply by email.
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

            <span className={styles.counter}>
              {String(bodyTrimmed.length)} / {String(MAX_BODY)}
            </span>

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
              title="You have not raised anything yet"
              description="Requests you send appear here with their status and our reply."
            />
          }
        >
          {(data) => (
            <div className={styles.list}>
              {data.items.map((ticket) => (
                <Card key={ticket.id}>
                  <div className={styles.ticketTop}>
                    <span className={styles.subject}>{ticket.subject}</span>
                    <StatusBadge status={supportRequestState(ticket.status)} />
                  </div>
                  <span className={styles.reference}>{ticket.reference}</span>
                  <p className={styles.body}>{ticket.body}</p>
                  <div className={styles.meta}>
                    <span>Raised {formatDateTime(ticket.createdAt)}</span>
                    <span>{ticket.category}</span>
                    {ticket.resolvedAt === null ? null : (
                      <span>Resolved {formatDateTime(ticket.resolvedAt)}</span>
                    )}
                  </div>
                  {ticket.resolutionNote === null ? null : (
                    <div className={styles.resolution}>{ticket.resolutionNote}</div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </AsyncBoundary>
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
              title="No answers are published yet"
              description="When an administrator publishes an FAQ it appears here."
            />
          }
        >
          {(data) => (
            <Card>
              <div className={styles.faqs}>
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
