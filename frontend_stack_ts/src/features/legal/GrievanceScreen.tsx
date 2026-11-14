import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { CLIENT_SUPPORT_PATH } from "~/app/routing/clientRoutes"
import { formatDate } from "~/domain/dates"
import { useLegalDocument } from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow, Prose } from "~/ui/patterns/DataList"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { PROSE_PANEL } from "~/ui/recipes/surface"
import { CARD_TITLE, META_ROW } from "~/ui/recipes/text"

import { LegalSections } from "./LegalSections"
import { PublishedContactList } from "./PublishedContactList"
import { readBody, readContacts, readFacts, readSections, type PublishedDocument } from "./publishedContent"

const FALLBACK =
  "The full grievance policy is not available yet. You can still raise a complaint through support. It gets a reference straight away, and the BeOnEdge team will review it."

const RAISE_FIRST =
  "Send the details through support. You get a reference straight away, and the BeOnEdge team will review the request and update its status there."

const URGENT_CONTACTS = " For anything urgent, use the grievance contacts above."

const GrievanceScreen = (): React.ReactElement => {
  const query = useLegalDocument("grievance")
  const hasContacts = query.data !== undefined && readContacts(query.data).length > 0

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
          const document = data as unknown as PublishedDocument
          const steps = readSections(document, "steps")
          const sections = steps.length > 0 ? steps : readSections(document, "sections")
          const timelines = readFacts(document, "timelines")
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

              {timelines.length === 0 ? null : (
                <>
                  <h2 className={CARD_TITLE}>Timelines</h2>
                  <DataList>
                    {timelines.map((fact) => (
                      <DetailRow key={fact.label} label={fact.label}>
                        {fact.value}
                      </DetailRow>
                    ))}
                  </DataList>
                </>
              )}

              {contacts.length === 0 ? null : (
                <>
                  <h2 className={CARD_TITLE}>Grievance contacts</h2>
                  <PublishedContactList contacts={contacts} />
                </>
              )}

              {isPublished ? null : <Prose>{FALLBACK}</Prose>}
            </Card>
          )
        }}
      </AsyncBoundary>

      <Section
        title="Raise it with us first"
        description={hasContacts ? `${RAISE_FIRST}${URGENT_CONTACTS}` : RAISE_FIRST}
      >
        <ButtonLink to={CLIENT_SUPPORT_PATH} trailing>
          Open support
        </ButtonLink>
      </Section>
    </Page>
  )
}

export default GrievanceScreen
