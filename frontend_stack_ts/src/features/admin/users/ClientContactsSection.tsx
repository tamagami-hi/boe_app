import { useState } from "react"

import type { getAdminUser } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"

import { PROSE_SM } from "~/ui/recipes/datalist"

import { ContactCorrectionForm } from "./ContactCorrectionForm"
import { ContactHistoryList } from "./ContactHistoryList"
import { ContactReleasePanel } from "./ContactReleasePanel"
import { useAdminUserContactHistory, type CorrectedContacts } from "./contactQueries"
import { useAdminClientPasswordAccess } from "./passwordLinkQueries"

type AdminUser = DataOf<typeof getAdminUser>["user"]

type ContactsProps = Readonly<{
  user: AdminUser
  reloading: boolean
  onReload: () => Promise<boolean>
}>

const correctedMessage = (result: CorrectedContacts): string =>
  result.passwordLink === null
    ? `The phone number is now ${result.phone}. No email was sent and the invite link is unchanged.`
    : `The email is now ${result.email}. A new invite link is queued for it and expires ${formatDateTime(result.passwordLink.expiresAt)}; every earlier link no longer works. Watch its email state in the invite panel.`

const CorrectionGate = ({ user, reloading, onReload }: ContactsProps): React.ReactElement => {
  const access = useAdminClientPasswordAccess(user.id)
  const { hasAnyPermission } = useSession()
  const canCorrect = hasAnyPermission(["clients.create"]) && hasAnyPermission(["clients.password_links.send"])
  const [corrected, setCorrected] = useState<CorrectedContacts | null>(null)

  return (
    <>
      {corrected === null ? null : (
        <Alert tone="success" title="Contact corrected">
          {correctedMessage(corrected)}
        </Alert>
      )}
      <AsyncBoundary query={access} skeleton={<Skeleton height="3rem" />}>
        {(data) => {
          if (data.hasPassword) {
            return (
              <p className={PROSE_SM}>
                This client has set a password, so they change their own email or phone from their profile.
              </p>
            )
          }
          if (!canCorrect) {
            return (
              <p className={PROSE_SM}>
                Correcting an invitee's email or phone needs the clients.create and clients.password_links.send
                permissions.
              </p>
            )
          }
          return (
            <ContactCorrectionForm
              key={`${user.email}|${user.phone}|${String(user.version)}`}
              userId={user.id}
              email={user.email}
              phone={user.phone}
              version={user.version}
              reloading={reloading}
              onReload={onReload}
              onCorrected={setCorrected}
            />
          )
        }}
      </AsyncBoundary>
    </>
  )
}

export const ClientContactsSection = ({ user, reloading, onReload }: ContactsProps): React.ReactElement => {
  const history = useAdminUserContactHistory(user.id)

  return (
    <Section
      title="Email and phone"
      description="Correct a mistyped contact before the client sets a password, or free a closed account's contacts for a new account."
    >
      <Card>
        {user.accountState === "active" ? (
          <CorrectionGate user={user} reloading={reloading} onReload={onReload} />
        ) : null}
        <AsyncBoundary query={history} skeleton={<Skeleton height="3rem" />}>
          {(data) => (
            <>
              {user.accountState === "closed" ? (
                <ContactReleasePanel
                  userId={user.id}
                  version={user.version}
                  releasedAt={data.contactsReleasedAt}
                  reloading={reloading}
                  onReload={onReload}
                />
              ) : null}
              <ContactHistoryList entries={data.entries} />
            </>
          )}
        </AsyncBoundary>
      </Card>
    </Section>
  )
}
