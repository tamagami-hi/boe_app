import { useLegalDocument } from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { Prose } from "~/ui/patterns/DataList"
import { Skeleton } from "~/ui/primitives/Feedback"

import { PublishedContactList } from "./PublishedContactList"
import { readContacts, type LegalContact, type PublishedDocument } from "./publishedContent"

const SUPPORT_CONTACT_DOCUMENT = "investor-charter"

const contactsOf = (data: unknown): readonly LegalContact[] => readContacts(data as PublishedDocument)

export type ContactPick = (contact: LegalContact) => boolean

const picked = (contacts: readonly LegalContact[], pick: ContactPick | undefined): readonly LegalContact[] =>
  pick === undefined ? contacts : contacts.filter(pick)

export const useSupportContacts = (pick?: ContactPick): readonly LegalContact[] => {
  const query = useLegalDocument(SUPPORT_CONTACT_DOCUMENT)
  return query.data === undefined ? [] : picked(contactsOf(query.data), pick)
}

export type SupportContactsProps = Readonly<{ unpublished: string; pick?: ContactPick }>

export const SupportContacts = ({ unpublished, pick }: SupportContactsProps): React.ReactElement => {
  const query = useLegalDocument(SUPPORT_CONTACT_DOCUMENT)

  return (
    <AsyncBoundary
      query={query}
      skeleton={<Skeleton height="2.4rem" width="60%" />}
      fallback={<Prose>{unpublished}</Prose>}
    >
      {(data) => {
        const contacts = picked(contactsOf(data), pick)
        return contacts.length === 0 ? <Prose>{unpublished}</Prose> : <PublishedContactList contacts={contacts} />
      }}
    </AsyncBoundary>
  )
}
