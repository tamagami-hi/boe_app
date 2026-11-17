import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { isNative } from "~/platform/capacitor"
import { DataList } from "~/ui/patterns/DataList"
import { Card } from "~/ui/primitives/Card"

import { InstalledVersionRow } from "./InstalledVersionRow"
import { WhatsNewNotes } from "./WhatsNewNotes"
import { whatsNewNotes } from "./whatsNewNotes"

const WhatsNewScreen = (): React.ReactElement => (
  <Page width="default">
    <PageHeader title="What's new" description="What changed in each release, newest first." />

    {isNative() ? (
      <Card>
        <DataList>
          <InstalledVersionRow label="Installed version" />
        </DataList>
      </Card>
    ) : null}

    {whatsNewNotes().map((entry) => (
      <Section key={entry.id} title={`Version ${entry.id}`}>
        <Card>
          <WhatsNewNotes entry={entry} />
        </Card>
      </Section>
    ))}
  </Page>
)

export default WhatsNewScreen
