import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { DataList } from "~/ui/patterns/DataList"
import { Card } from "~/ui/primitives/Card"

import { InstalledVersionRow } from "./InstalledVersionRow"
import type { WhatsNewNotes as Notes } from "./whatsNewEntry"
import { WhatsNewNotes } from "./WhatsNewNotes"

export type WhatsNewScreenProps = Readonly<{ notes: Notes }>

export const WhatsNewScreen = ({ notes }: WhatsNewScreenProps): React.ReactElement => (
  <Page width="default">
    <PageHeader title="What's new" description="What changed in each release, newest first." />

    <Card>
      <DataList>
        <InstalledVersionRow label="Version" />
      </DataList>
    </Card>

    {notes.map((entry) => (
      <Section key={entry.id} title={`Version ${entry.id}`}>
        <Card>
          <WhatsNewNotes entry={entry} />
        </Card>
      </Section>
    ))}
  </Page>
)
