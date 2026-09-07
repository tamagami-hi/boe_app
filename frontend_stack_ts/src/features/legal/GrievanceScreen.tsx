

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { useToast } from "~/app/providers/ToastProvider"
import { Section } from "~/app/layouts/Section"
import { CLIENT_ROUTES, CLIENT_SUPPORT_PATH } from "~/app/routing/clientRoutes"
import { resolveDestination } from "~/app/routing/resolveDestination"
import { formatDate } from "~/domain/dates"
import { openDestination } from "~/platform/openExternal"
import { useLegalDocument } from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { Prose } from "~/ui/patterns/DataList"

import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { PROSE_PANEL } from "~/ui/recipes/surface"
import { CARD_TITLE, LINK_TEXT_SM, META_ROW } from "~/ui/recipes/text"

import {
  CONTACT_LABEL,
  CONTACT_LIST,
  DOC_LIST,
  DOC_SECTION,
  CONTACT_ROW,
  CONTACT_VALUE,
} from "./legal.recipe"

const FALLBACK =
  "The full grievance policy is not available yet. You can still raise a complaint through support, and we will give you a reference for it."

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
  const toast = useToast()

  const follow = (candidate: string): void => {
    void openDestination(resolveDestination(candidate, CLIENT_ROUTES)).then((result) => {
      if (result.ok) return
      toast.show("We couldn't open that on this device.", "error")
    })
  }

  return (
    <Page width="default">
      <PageHeader
        title="Grievance redressal"
        description="How to raise a complaint and what happens next."
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
          <div className={PROSE_PANEL}>
            <Prose>{FALLBACK}</Prose>
          </div>
        }
      >
        {(data) => {
          const document = data as unknown as Record<string, unknown>
          const steps = readSteps(document)
          const contacts = readContacts(document)
          const body = asString(document.body)
          const isPublished = body !== null || steps.length > 0 || contacts.length > 0

          return (
            <Card>
              {!isPublished || data.updatedAt === null ? null : (
                <div className={META_ROW}>
                  <span>Updated {formatDate(data.updatedAt)}</span>
                </div>
              )}

              {body === null ? null : <Prose>{body}</Prose>}

              {steps.length === 0 ? null : (
                <div className={DOC_LIST}>
                  {steps.map((step) => (
                    <div key={step.heading} className={DOC_SECTION}>
                      <h2 className={CARD_TITLE}>{step.heading}</h2>
                      <Prose>{step.body}</Prose>
                    </div>
                  ))}
                </div>
              )}

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
                          className={LINK_TEXT_SM}
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

              {isPublished ? null : <Prose>{FALLBACK}</Prose>}
            </Card>
          )
        }}
      </AsyncBoundary>

      <Section
        title="Raise it with us first"
        description="Send us the details and we will give you a reference to follow it."
      >
        <ButtonLink to={CLIENT_SUPPORT_PATH} trailing>
Open support
</ButtonLink>
      </Section>
    </Page>
  )
}

export default GrievanceScreen
