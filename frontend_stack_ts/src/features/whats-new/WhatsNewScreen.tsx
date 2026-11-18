import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { DataList } from "~/ui/patterns/DataList"
import { Card } from "~/ui/primitives/Card"

import { InstalledVersionRow } from "./InstalledVersionRow"
import type { WhatsNewNotes as Notes } from "./whatsNewEntry"
import { WhatsNewReleases } from "./WhatsNewReleases"

export type WhatsNewScreenProps = Readonly<{ notes: Notes }>

export const WhatsNewScreen = ({ notes }: WhatsNewScreenProps): React.ReactElement => (
  <Page width="default">
    <PageHeader
      title="What's new"
      description="What changed in each release, newest first. Open a version to read its notes."
    />

    <Card>
      <DataList>
        <InstalledVersionRow label="App version" />
      </DataList>
    </Card>

    <Card>
      <WhatsNewReleases entries={notes} headingLevel="h2" />
    </Card>
  </Page>
)
