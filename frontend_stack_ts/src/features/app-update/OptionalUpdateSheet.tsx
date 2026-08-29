import { Modal } from "~/app/overlays/Modal"
import { Button } from "~/ui/primitives/Button"

import { UpdateInstallPanel } from "./UpdateInstallPanel"
import type { UpdateRelease } from "./updateDecision"
import type { UpdateInstaller } from "./useUpdateInstaller"

export type OptionalUpdateSheetProps = Readonly<{
  open: boolean
  release: UpdateRelease
  installer: UpdateInstaller
  onDismiss: () => void
}>

export const OptionalUpdateSheet = ({
  open,
  release,
  installer,
  onDismiss,
}: OptionalUpdateSheetProps): React.ReactElement => (
  <Modal
    open={open}
    title="A newer BeOnEdge is available"
    description="You can keep using this version. Updating is optional."
    onDismiss={onDismiss}
    actions={
      <Button tone="ghost" onClick={onDismiss}>
        Not now
      </Button>
    }
  >
    <UpdateInstallPanel release={release} installer={installer} />
  </Modal>
)
