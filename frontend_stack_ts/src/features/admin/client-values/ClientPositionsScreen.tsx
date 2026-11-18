import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ContentGrid } from "~/app/layouts/ContentGrid"
import { useSession } from "~/app/providers/SessionProvider"
import { useRouteAccess } from "~/features/admin/shared/routeAccess"
import { Prose, Stat } from "~/ui/patterns/DataList"

import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"

const ENTRIES = [
  {
    routeId: "client-values-monthly",
    to: "/client-values/monthly",
    title: "Monthly value update",
    hint: "Type each client's gain since they invested for one fund. The changes are previewed and written together. Each client is told in the app, and active clients by email too.",
  },
  {
    routeId: "client-values-payment-sheet",
    to: "/client-values/payment-sheet",
    title: "Monthly payments",
    hint: "Record a month of SIP payments for every client in one sheet, or paste them in. Each row is recorded on its own. Each client is told in the app, and active clients get an email with the SIP month and amount.",
  },
  {
    routeId: "client-values-individual",
    to: "/client-values/individual",
    title: "One investor",
    hint: "Adjust a single position by an amount or a rate. Written straight to the ledger.",
  },
  {
    routeId: "client-values-collective",
    to: "/client-values/collective",
    title: "A whole fund",
    hint: "Preview every position in a fund, then commit exactly the figures the preview showed.",
  },
  {
    routeId: "client-values-position",
    to: "/client-values/position",
    title: "One investor's record",
    hint: "See every position and ledger entry, record an investment, and reverse an entry that should not be there.",
  },
] as const

const ClientValuesScreen = (): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canOpen = useRouteAccess()
  const canWrite = hasAnyPermission(["client_growth.write", "client_position.write"])

  return (
    <Page width="default">
      <PageHeader
        title="Client values"
        description="Each investor's value is the total of the entries recorded for them. Nothing here overwrites a balance: every adjustment adds a new entry, and the value is worked out again from all of them."
      />

      {canWrite ? null : (
        <Alert tone="info" title="You can read this but not adjust values">
          Your role cannot adjust investor values, record earlier investments or reverse entries.
        </Alert>
      )}

      <Section title="What do you want to adjust?">
        <ContentGrid columns={2}>
          {ENTRIES.map((entry) => (
            <Card key={entry.to} elevated>
              <Stat label={entry.title} hint={entry.hint}>
                <span />
              </Stat>
              <ButtonLink to={entry.to} tone="secondary" size="sm" disabled={!canOpen(entry.routeId)} trailing>
                Open
              </ButtonLink>
            </Card>
          ))}
        </ContentGrid>
      </Section>

      <Section title="What an adjustment does">
        <Card>
          <Prose>
            An adjustment appends a growth entry against a position. The investor is told in the app
            that their value changed, without an amount. If their account is active, an email also shows
            the change and their new value in that fund. The entry is dated by the effective date you
            choose, so it lands in that month&apos;s statement. A negative adjustment is allowed, but one that would take a position below zero is refused rather
            than stopped at zero.
          </Prose>
        </Card>
      </Section>
    </Page>
  )
}

export default ClientValuesScreen
