import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { ACTION_ROW, GATE_TITLE } from "~/ui/recipes/layout"
import { BLOCK_HEAD, BLOCK_LAYER, BLOCK_MARK, BLOCK_PANEL } from "~/ui/recipes/overlay"
import { BODY_TEXT, HONESTY_TEXT } from "~/ui/recipes/text"

export type MaintenanceScreenProps = Readonly<{
  checking: boolean
  onCheck: () => void
}>

export const MaintenanceScreen = ({ checking, onCheck }: MaintenanceScreenProps): React.ReactElement => (
  <div className={BLOCK_LAYER} role="dialog" aria-modal="true" aria-label="BeOnEdge is being updated">
    <div className={BLOCK_PANEL}>
      <div className={BLOCK_HEAD}>
        <span className={BLOCK_MARK}>BeOnEdge</span>
        <h1 className={GATE_TITLE}>We are updating BeOnEdge</h1>
      </div>

      <p className={BODY_TEXT}>
        An update is being installed. This usually takes a few minutes. Nothing you saved has been lost,
        and this screen closes by itself when the update is done.
      </p>

      <Card elevated>
        <p className={HONESTY_TEXT}>We check again every 30 seconds.</p>
        <div className={ACTION_ROW}>
          <Button tone="secondary" loading={checking} onClick={onCheck}>
            Check now
          </Button>
        </div>
      </Card>
    </div>
  </div>
)
