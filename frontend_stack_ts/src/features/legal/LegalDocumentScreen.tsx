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
import { PROSE_PANEL } from "~/ui/recipes/surface"
import { CARD_TITLE, META_ROW } from "~/ui/recipes/text"

import { LegalSections } from "./LegalSections"
import { PublishedContactList } from "./PublishedContactList"
import { readBody, readContacts, readSections, type PublishedDocument } from "./publishedContent"

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
          const document = data as unknown as PublishedDocument
          const sections = readSections(document, "sections")
          const contacts = readContacts(document)
          const body = readBody(document)
          const isPublished = body !== null || sections.length > 0 || contacts.length > 0

          return (
            <Card>
              {!isPublished || data.updatedAt === null ? null : (
                <div className={META_ROW}>
                  <span>Updated {formatDate(data.updatedAt)}</span>
                </div>
              )}

              {body === null ? null : <Prose>{body}</Prose>}

              <LegalSections sections={sections} />

              {contacts.length === 0 ? null : (
                <>
                  <h2 className={CARD_TITLE}>Contact</h2>
                  <PublishedContactList contacts={contacts} />
                </>
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
