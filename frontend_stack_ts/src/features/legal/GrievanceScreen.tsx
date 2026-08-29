import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { CLIENT_ROUTES, CLIENT_SUPPORT_PATH } from "~/app/routing/clientRoutes"
import { resolveDestination } from "~/app/routing/resolveDestination"
import { formatDate } from "~/domain/dates"
import { openDestination } from "~/platform/openExternal"
import { useLegalDocument } from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { Prose } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { STACK_SM } from "~/ui/recipes/layout"
import { META_ROW, SUBHEAD_TITLE } from "~/ui/recipes/text"

import {
  CONTACT_ACTION,
  CONTACT_LABEL,
  CONTACT_LIST,
  CONTACT_ROW,
  CONTACT_VALUE,
} from "./legal.recipe"

const FALLBACK =
  "The grievance redressal policy has not been published to this environment yet. You can still raise a complaint through support and it will be recorded with a reference you can quote."

type Step = Readonly<{ heading: string; body: string }>
type Contact = Readonly<{ label: string; value: string; href: string | null }>

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null

const readSteps = (document: Record<string, unknown>): readonly Step[] => {
  const raw = Array.isArray(document.steps)
    ? document.steps
    : Array.isArray(document.sections)
      ? document.sections
      : []
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return []
    const record = entry as Record<string, unknown>
    const heading = asString(record.heading) ?? asString(record.title) ?? asString(record.stage)
    const body = asString(record.body) ?? asString(record.text) ?? asString(record.detail)
    if (heading === null || body === null) return []
    return [{ heading, body }]
  })
}

const readContacts = (document: Record<string, unknown>): readonly Contact[] => {
  const raw = Array.isArray(document.contacts) ? document.contacts : []
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return []
    const record = entry as Record<string, unknown>
    const label = asString(record.label) ?? asString(record.name)
    const value =
      asString(record.value) ?? asString(record.email) ?? asString(record.phone) ?? asString(record.url)
    if (label === null || value === null) return []
    return [{ label, value, href: asString(record.url) ?? asString(record.href) }]
  })
}

const GrievanceScreen = (): React.ReactElement => {
  const query = useLegalDocument("grievance")

  const follow = (candidate: string): void => {
    void openDestination(resolveDestination(candidate, CLIENT_ROUTES))
  }

  return (
    <Page width="default">
      <PageHeader
        title="Grievance redressal"
        description="How to raise a complaint, what happens next, and how to escalate if we do not resolve it."
      />

      <AsyncBoundary
        query={query}
        skeleton={
          <Card>
            <Skeleton height="0.9rem" width="35%" />
            <Skeleton height="4rem" />
          </Card>
        }
        fallback={
          <Card>
            <Prose>{FALLBACK}</Prose>
          </Card>
        }
      >
        {(data) => {
          const document = data as unknown as Record<string, unknown>
          const steps = readSteps(document)
          const contacts = readContacts(document)
          const body = asString(document.body)

          return (
            <Card>
              <div className={META_ROW}>
                <span>Version {String(data.version)}</span>
                {data.updatedAt === null ? null : <span>Updated {formatDate(data.updatedAt)}</span>}
              </div>

              {body === null ? null : <Prose>{body}</Prose>}

              {steps.map((step) => (
                <div key={step.heading} className={STACK_SM}>
                  <h2 className={SUBHEAD_TITLE}>{step.heading}</h2>
                  <Prose>{step.body}</Prose>
                </div>
              ))}

              {contacts.length === 0 ? null : (
                <ul className={CONTACT_LIST}>
                  {contacts.map((contact) => (
                    <li key={contact.label} className={CONTACT_ROW}>
                      <span className={CONTACT_LABEL}>{contact.label}</span>
                      {contact.href === null ? (
                        <span className={CONTACT_VALUE}>{contact.value}</span>
                      ) : (
                        <button
                          type="button"
                          className={CONTACT_ACTION}
                          onClick={() => {
                            follow(contact.href ?? "")
                          }}
                        >
                          {contact.value}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {body === null && steps.length === 0 && contacts.length === 0 ? (
                <Prose>{FALLBACK}</Prose>
              ) : null}
            </Card>
          )
        }}
      </AsyncBoundary>

      <Section
        title="Raise it with us first"
        description="Every complaint you raise through support is recorded with a reference you can quote later."
      >
        <Link to={CLIENT_SUPPORT_PATH}>
          <Button trailing>Open support</Button>
        </Link>
      </Section>
    </Page>
  )
}

export default GrievanceScreen
