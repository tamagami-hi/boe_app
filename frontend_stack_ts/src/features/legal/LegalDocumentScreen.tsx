import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDate } from "~/domain/dates"
import { useLegalDocument } from "~/features/shared/queries"
import type { LegalDocumentKind } from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { Prose } from "~/ui/patterns/DataList"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { STACK_SM } from "~/ui/recipes/layout"
import { PROSE_PANEL } from "~/ui/recipes/surface"
import { CARD_TITLE, META_ROW } from "~/ui/recipes/text"

import {
  CONTACT_LABEL,
  CONTACT_LIST,
  CONTACT_ROW,
  CONTACT_VALUE,
} from "./legal.recipe"

export type LegalSection = Readonly<{ heading: string; body: string }>

export type LegalContact = Readonly<{ label: string; value: string }>

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null

const readSections = (document: Record<string, unknown>): readonly LegalSection[] => {
  const raw = document.sections
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return []
    const record = entry as Record<string, unknown>
    const heading = asString(record.heading) ?? asString(record.title)
    const body = asString(record.body) ?? asString(record.text)
    if (heading === null || body === null) return []
    return [{ heading, body }]
  })
}

const readContacts = (document: Record<string, unknown>): readonly LegalContact[] => {
  const raw = document.contacts
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return []
    const record = entry as Record<string, unknown>
    const label = asString(record.label) ?? asString(record.name)
    const value = asString(record.value) ?? asString(record.email) ?? asString(record.phone)
    if (label === null || value === null) return []
    return [{ label, value }]
  })
}

export type LegalDocumentScreenProps = Readonly<{
  kind: LegalDocumentKind
  title: string
  description: string
  fallback: string
}>

export const LegalDocumentScreen = ({
  kind,
  title,
  description,
  fallback,
}: LegalDocumentScreenProps): React.ReactElement => {
  const query = useLegalDocument(kind)

  return (
    <Page width="default">
      <PageHeader title={title} description={description} />

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
            <Prose>{fallback}</Prose>
            <ButtonLink to="/profile/support" tone="secondary" size="sm" trailing>
              Contact support
            </ButtonLink>
          </div>
        }
      >
        {(data) => {
          const document = data as unknown as Record<string, unknown>
          const sections = readSections(document)
          const contacts = readContacts(document)
          const body = asString(document.body)
          const isPublished = body !== null || sections.length > 0 || contacts.length > 0

          return (
            <Card>
              {!isPublished || data.updatedAt === null ? null : (
                <div className={META_ROW}>
                  <span>Updated {formatDate(data.updatedAt)}</span>
                </div>
              )}

              {body === null ? null : <Prose>{body}</Prose>}

              {sections.map((section) => (
                <div key={section.heading} className={STACK_SM}>
                  <h2 className={CARD_TITLE}>{section.heading}</h2>
                  <Prose>{section.body}</Prose>
                </div>
              ))}

              {contacts.length === 0 ? null : (
                <ul className={CONTACT_LIST}>
                  {contacts.map((contact) => (
                    <li key={contact.label} className={CONTACT_ROW}>
                      <span className={CONTACT_LABEL}>{contact.label}</span>
                      <span className={CONTACT_VALUE}>{contact.value}</span>
                    </li>
                  ))}
                </ul>
              )}

              {isPublished ? null : (
                <>
                  <Prose>{fallback}</Prose>
                  <ButtonLink to="/profile/support" tone="secondary" size="sm" trailing>
                    Contact support
                  </ButtonLink>
                </>
              )}
            </Card>
          )
        }}
      </AsyncBoundary>
    </Page>
  )
}
