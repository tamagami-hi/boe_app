import { useToast } from "~/app/providers/ToastProvider"
import { resolveDestination, type Destination } from "~/app/routing/resolveDestination"
import type { RouteManifest } from "~/app/routing/routeManifest"
import { openDestination } from "~/platform/openExternal"
import { LINK_TEXT_SM } from "~/ui/recipes/text"

import { CONTACT_LABEL, CONTACT_LIST, CONTACT_ROW, CONTACT_VALUE } from "./legal.recipe"
import type { LegalContact } from "./publishedContent"

const NO_IN_APP_ROUTES: RouteManifest = []

const externalDestination = (href: string | null): Destination | null => {
  if (href === null) return null
  const destination = resolveDestination(href, NO_IN_APP_ROUTES)
  return destination.kind === "refused" || destination.kind === "internal" ? null : destination
}

export type PublishedContactListProps = Readonly<{ contacts: readonly LegalContact[] }>

export const PublishedContactList = ({ contacts }: PublishedContactListProps): React.ReactElement => {
  const toast = useToast()

  const follow = (destination: Destination): void => {
    void openDestination(destination).then((result) => {
      if (result.ok) return
      toast.show("We couldn't open that on this device.", "error")
    })
  }

  return (
    <ul className={CONTACT_LIST}>
      {contacts.map((contact) => {
        const destination = externalDestination(contact.href)
        return (
          <li key={`${contact.label}-${contact.value}`} className={CONTACT_ROW}>
            <span className={CONTACT_LABEL}>{contact.label}</span>
            {destination === null ? (
              <span className={CONTACT_VALUE}>{contact.value}</span>
            ) : (
              <button
                type="button"
                className={LINK_TEXT_SM}
                onClick={() => {
                  follow(destination)
                }}
              >
                {contact.value}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
