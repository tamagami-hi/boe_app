import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { ACTION_ROW } from "~/ui/recipes/layout"
import { BLOCK_HEAD, BLOCK_LAYER, BLOCK_MARK, BLOCK_PANEL } from "~/ui/recipes/overlay"
import { BODY_TEXT, HONESTY_TEXT, PAGE_TITLE } from "~/ui/recipes/text"

import { UpdateInstallPanel } from "./UpdateInstallPanel"
import type { UpdateRelease } from "./updateDecision"
import type { UpdateInstaller } from "./useUpdateInstaller"

export const MANDATORY_EXPLANATION =
  "This version of BeOnEdge is out of date and can no longer be used safely. Update to carry on."

export const NO_RELEASE_EXPLANATION =
  "A newer version isn't ready for this device yet. Check again shortly, or contact support if you need help."

export type MandatoryUpdateScreenProps = Readonly<{
  release: UpdateRelease | null
  installer: UpdateInstaller
  onRecheck: () => void
  rechecking: boolean
}>

export const MandatoryUpdateScreen = ({
  release,
  installer,
  onRecheck,
  rechecking,
}: MandatoryUpdateScreenProps): React.ReactElement => (
  <div
    className={BLOCK_LAYER}
    role="dialog"
    aria-modal="true"
    aria-label="BeOnEdge needs updating"
  >
    <div className={BLOCK_PANEL}>
      <div className={BLOCK_HEAD}>
        <span className={BLOCK_MARK}>BeOnEdge</span>
        <h1 className={PAGE_TITLE}>Update required</h1>
      </div>

      <p className={BODY_TEXT}>{MANDATORY_EXPLANATION}</p>

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
