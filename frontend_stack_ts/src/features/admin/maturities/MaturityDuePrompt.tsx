import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"

import { Modal } from "~/app/overlays/Modal"
import { useOverlayStack } from "~/app/providers/OverlayStackProvider"
import { useSession } from "~/app/providers/SessionProvider"
import { ClientPageLink } from "~/features/admin/shared/clientPageLink"
import { useHasUnsettledHeldWrite } from "~/features/admin/shared/unsettledHeldWrites"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { Badge } from "~/ui/primitives/Badge"
import { Button } from "~/ui/primitives/Button"
import { Skeleton } from "~/ui/primitives/Feedback"
import { ENTRY_TEXT, LIST_ROOT, LIST_ROW } from "~/ui/recipes/datalist"
import { BODY_SM, META_TEXT } from "~/ui/recipes/text"

import { MaturityActionButtons, MaturityActionDialog, type MaturityAction } from "./MaturityActions"
import { dueBadgeOf, dueTextOf, formatMaturityDate, offerStatusText } from "./maturityPresentation"
import { useDueMaturities } from "./maturityQueries"

export type MaturityDuePromptProps = Readonly<{ dismissed: boolean; onDismiss: () => void }>

const READ_PERMISSIONS = ["client_position.write", "client_values.read"] as const
const WRITE_PERMISSIONS = ["client_position.write"] as const

export const MaturityDuePrompt = ({ dismissed, onDismiss }: MaturityDuePromptProps): React.ReactElement | null => {
  const { hasAnyPermission } = useSession()
  const navigate = useNavigate()
  const canRead = hasAnyPermission(READ_PERMISSIONS)
  const canWrite = hasAnyPermission(WRITE_PERMISSIONS)
  const due = useDueMaturities(canRead && !dismissed)
  const { depth } = useOverlayStack()
  const isHoldingWrite = useHasUnsettledHeldWrite()
  const [acting, setActing] = useState<MaturityAction | null>(null)
  const [isArmed, setArmed] = useState(false)
  const [isShown, setShown] = useState(false)
  const hasDue = due.data !== undefined && due.data.total > 0
  const readFailed = due.data === undefined && due.isError
  const canOpen = canRead && !dismissed && (hasDue || readFailed) && depth === 0 && !isHoldingWrite

  useEffect(() => {
    if (!canOpen || isShown) return
    if (isArmed) setShown(true)
    else setArmed(true)
  }, [canOpen, isArmed, isShown])

  if (!canRead || dismissed) return null
  if (acting !== null) {
    return (
      <MaturityActionDialog
        key={`${acting.schedule.scheduleId}-${acting.kind}`}
        userId={acting.schedule.userId}
        action={acting}
        onClose={() => {
          setActing(null)
        }}
      />
    )
  }
  if (!isShown || (!hasDue && !readFailed)) return null

  const openDashboard = (): void => {
    onDismiss()
    void navigate("/maturities")
  }

  return (
    <Modal
      open
      title={hasDue ? "Maturities need your decision" : "Maturities not checked"}
      description={
        hasDue
          ? "Nothing is paid out or reinvested until you resolve each one or confirm the client's choice. This reminder returns the next time the console opens."
          : "The console could not read which holdings mature soon. Try again, or open the maturities page. Nothing is paid out or reinvested by itself."
      }
      onDismiss={onDismiss}
      actions={
        <>
          <Button tone="secondary" onClick={onDismiss}>
            Remind me next time
          </Button>
          <Button onClick={openDashboard}>Open maturities</Button>
        </>
      }
    >
      <AsyncBoundary query={due} skeleton={<Skeleton height="2rem" />}>
        {(data) => (
          <>
            <p className={BODY_SM}>
              {`${String(data.total)} ${data.total === 1 ? "holding matures" : "holdings mature"} by ${formatMaturityDate(data.dueThrough)} or ${data.total === 1 ? "is" : "are"} overdue. Resolve each one after talking to the client, or send the options so the client can choose in the app.`}
            </p>
            <ul className={LIST_ROOT}>
              {data.items.map((item) => {
                const badge = dueBadgeOf(item)
                const offerText = offerStatusText(item.offer)
                return (
                  <li key={item.scheduleId} className={LIST_ROW}>
                    <span className={ENTRY_TEXT}>
                      <ClientPageLink userId={item.userId} onOpen={onDismiss}>
                        {item.clientName}
                      </ClientPageLink>
                      <span className={META_TEXT}>
                        {`${item.fundName}, ${formatMaturityDate(item.maturityDate)}, ${dueTextOf(item)}`}
                      </span>
                      {offerText === null ? null : <span className={META_TEXT}>{offerText}</span>}
                      {canWrite ? <MaturityActionButtons schedule={item} onAct={setActing} /> : null}
                    </span>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </li>
                )
              })}
            </ul>
            {data.total > data.items.length ? (
              <p className={META_TEXT}>{`${String(data.total - data.items.length)} more on the maturities page.`}</p>
            ) : null}
          </>
        )}
      </AsyncBoundary>
    </Modal>
  )
}
