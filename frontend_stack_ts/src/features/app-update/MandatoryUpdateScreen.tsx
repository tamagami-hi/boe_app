import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { ACTION_ROW } from "~/ui/recipes/layout"
import { BLOCK_HEAD, BLOCK_LAYER, BLOCK_MARK, BLOCK_PANEL } from "~/ui/recipes/overlay"
import { BODY_TEXT, HONESTY_TEXT, PAGE_TITLE } from "~/ui/recipes/text"

import { UpdateInstallPanel } from "./UpdateInstallPanel"
import type { UpdateRelease } from "./updateDecision"
import type { UpdateInstaller } from "./useUpdateInstaller"

export const MANDATORY_EXPLANATION =
  "This build of BeOnEdge is older than the minimum version the service supports, so it has been stopped rather than left to fail against the server in ways you cannot see."

export const NO_RELEASE_EXPLANATION =
  "There is no newer build published for this device yet, so there is nothing to download here. Ask support for an APK, or try again once one is published."

export type MandatoryUpdateScreenProps = Readonly<{
  release: UpdateRelease | null
  minimumSupportedVersion: string | null
  installer: UpdateInstaller
  onRecheck: () => void
  rechecking: boolean
}>

export const MandatoryUpdateScreen = ({
  release,
  minimumSupportedVersion,
  installer,
  onRecheck,
  rechecking,
}: MandatoryUpdateScreenProps): React.ReactElement => (
  <div
    className={BLOCK_LAYER}
    role="dialog"
    aria-modal="true"
    aria-label="This version of BeOnEdge must be updated"
  >
    <div className={BLOCK_PANEL}>
      <div className={BLOCK_HEAD}>
        <span className={BLOCK_MARK}>BeOnEdge</span>
        <h1 className={PAGE_TITLE}>Update required</h1>
      </div>

      <p className={BODY_TEXT}>{MANDATORY_EXPLANATION}</p>

      {minimumSupportedVersion === null ? null : (
        <Alert tone="info" title="Minimum supported version">
          {minimumSupportedVersion}
        </Alert>
      )}

      <Card elevated>
        {release === null ? (
          <>
            <p className={HONESTY_TEXT}>{NO_RELEASE_EXPLANATION}</p>
            <div className={ACTION_ROW}>
              <Button tone="secondary" loading={rechecking} onClick={onRecheck}>
                Check again
              </Button>
            </div>
          </>
        ) : (
          <UpdateInstallPanel release={release} installer={installer} />
        )}
      </Card>
    </div>
  </div>
)
