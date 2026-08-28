import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Alert } from "~/ui/primitives/Feedback"

export type PendingScreenProps = Readonly<{
  title: string
  surface: string
}>

export const PendingScreen = ({ title, surface }: PendingScreenProps): React.ReactElement => (
  <Page width="default">
    <PageHeader title={title} />
    <Alert tone="info" title="Not built yet">
      The {surface} surface is not implemented in this build. It is a declared route with no
      behaviour behind it, not a failed load.
    </Alert>
  </Page>
)
