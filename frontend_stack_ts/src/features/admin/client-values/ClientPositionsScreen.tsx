

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ContentGrid } from "~/app/layouts/ContentGrid"
import { useSession } from "~/app/providers/SessionProvider"
import { Prose, Stat } from "~/ui/patterns/DataList"

import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"

const ENTRIES = [
  {
    to: "/client-values/individual",
    title: "One investor",
    hint: "Adjust a single position by an amount or a rate. Written straight to the ledger.",
  },
  {
    to: "/client-values/collective",
    title: "A whole fund",
    hint: "Preview every position in a fund, then commit the exact numbers the server recomputed.",
  },
  {
    to: "/client-values/position",
    title: "One investor's record",
    hint: "See every position and ledger entry, record an investment made before the app, and reverse an entry that should not be there.",
  },
] as const

const ClientValuesScreen = (): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canWrite = hasAnyPermission(["client_growth.write", "client_position.write"])

  return (
    <Page width="default">
      <PageHeader
        title="Client values"
        description="Investor value is an append-only ledger. Nothing here edits a stored balance, because there is no stored balance: every adjustment is a new entry the backend derives value from."
      />

      {canWrite ? null : (
        <Alert tone="info" title="You can read this but not adjust values">
          Adjusting investor value needs the client_growth.write permission. Recording an earlier
          investment or reversing an entry needs client_position.write.
        </Alert>
      )}

      <Section title="What do you want to adjust?">
        <ContentGrid columns={2}>
          {ENTRIES.map((entry) => (
            <Card key={entry.to} elevated>
              <Stat label={entry.title} hint={entry.hint}>
                <span />
              </Stat>
              <ButtonLink to={entry.to} tone="secondary" size="sm" disabled={!canWrite} trailing>
Open
</ButtonLink>
            </Card>
          ))}
        </ContentGrid>
      </Section>

      <Section title="What an adjustment does">
        <Card>
          <Prose>
            An adjustment appends a growth entry against a position and notifies the investor that
            their value changed. The notification never carries an amount. The entry is dated by the
            effective date you choose, so it lands in that month&apos;s statement. A negative
            adjustment is allowed, but one that would take a position below zero is refused by the
            backend rather than clamped.
          </Prose>
        </Card>
      </Section>
    </Page>
  )
}

export default ClientValuesScreen
