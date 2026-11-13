import { Link, useNavigate } from "react-router-dom"

import { Modal } from "~/app/overlays/Modal"
import { useSession } from "~/app/providers/SessionProvider"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { Badge } from "~/ui/primitives/Badge"
import { Button } from "~/ui/primitives/Button"
import { Skeleton } from "~/ui/primitives/Feedback"
import { ADMIN_CELL_LINK } from "~/ui/recipes/admin"
import { ENTRY_TEXT, LIST_ROOT, LIST_ROW } from "~/ui/recipes/datalist"
import { BODY_SM, META_TEXT } from "~/ui/recipes/text"

import { dueBadgeOf, dueTextOf, formatMaturityDate } from "./maturityPresentation"
import { useDueMaturities } from "./maturityQueries"

export type MaturityDuePromptProps = Readonly<{ dismissed: boolean; onDismiss: () => void }>

const READ_PERMISSIONS = ["client_position.write", "client_values.read"] as const

export const MaturityDuePrompt = ({ dismissed, onDismiss }: MaturityDuePromptProps): React.ReactElement | null => {
  const { hasAnyPermission } = useSession()
  const navigate = useNavigate()
  const canRead = hasAnyPermission(READ_PERMISSIONS)
  const due = useDueMaturities(canRead && !dismissed)
  const hasDue = due.data !== undefined && due.data.total > 0
  const readFailed = due.data === undefined && due.isError
  if (!canRead || dismissed || (!hasDue && !readFailed)) return null

  const openDashboard = (): void => {
    onDismiss()
    void navigate("/maturities")
  }

  return (
    <Modal
      open
      title="Maturities need your decision"
      description="Nothing is paid out or reinvested until you resolve each one. This reminder returns the next time the console opens."
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
              {`${String(data.total)} ${data.total === 1 ? "holding matures" : "holdings mature"} by ${formatMaturityDate(data.dueThrough)} or ${data.total === 1 ? "is" : "are"} overdue. Open a client to choose how to resolve it.`}
            </p>
            <ul className={LIST_ROOT}>
              {data.items.map((item) => {
                const badge = dueBadgeOf(item)
                return (
                  <li key={item.scheduleId} className={LIST_ROW}>
                    <span className={ENTRY_TEXT}>
                      <Link to={`/users/${item.userId}`} className={ADMIN_CELL_LINK} onClick={onDismiss}>
                        {item.clientName}
                      </Link>
                      <span className={META_TEXT}>
                        {`${item.fundName}, ${formatMaturityDate(item.maturityDate)}, ${dueTextOf(item)}`}
                      </span>
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
