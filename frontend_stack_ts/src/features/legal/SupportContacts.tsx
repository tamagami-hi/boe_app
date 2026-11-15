import { useLegalDocument } from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { Prose } from "~/ui/patterns/DataList"
import { Skeleton } from "~/ui/primitives/Feedback"

import { PublishedContactList } from "./PublishedContactList"
import { readContacts, type LegalContact, type PublishedDocument } from "./publishedContent"

const SUPPORT_CONTACT_DOCUMENT = "investor-charter"

const contactsOf = (data: unknown): readonly LegalContact[] => readContacts(data as PublishedDocument)

export const useSupportContacts = (): readonly LegalContact[] => {
  const query = useLegalDocument(SUPPORT_CONTACT_DOCUMENT)
  return query.data === undefined ? [] : contactsOf(query.data)
}

export type SupportContactsProps = Readonly<{ unpublished: string; pick?: (contact: LegalContact) => boolean }>

export const SupportContacts = ({ unpublished, pick }: SupportContactsProps): React.ReactElement => {
  const query = useLegalDocument(SUPPORT_CONTACT_DOCUMENT)

  return (
    <AsyncBoundary
      query={query}
      skeleton={<Skeleton height="2.4rem" width="60%" />}
      fallback={<Prose>{unpublished}</Prose>}
    >
      {(data) => {
        const published = contactsOf(data)
        const contacts = pick === undefined ? published : published.filter(pick)
        return contacts.length === 0 ? <Prose>{unpublished}</Prose> : <PublishedContactList contacts={contacts} />
      }}
    </AsyncBoundary>
  )
}
