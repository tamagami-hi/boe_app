import { isApiError, isSessionEnded } from "~/api/errors"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDate } from "~/domain/dates"
import { Stat } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { ADMIN_QUEUE_COUNT } from "~/ui/recipes/admin"
import { META_MUTED } from "~/ui/recipes/text"

import { useNomineeRequestSummary } from "./nomineeRequestQueries"

const LABEL = "Nominee requests waiting"
const HINT = "Clients asking to add or change their nominee. Nothing changes until you accept on the client page."

const PendingCount = (): React.ReactElement => {
  const summary = useNomineeRequestSummary(true)
  const { data, error } = summary
  if (data !== undefined) {
    return (
      <>
        <span className={ADMIN_QUEUE_COUNT}>{String(data.pendingCount)}</span>
        {data.oldestPendingAt === null ? null : (
          <span className={META_MUTED}>{`Oldest sent ${formatDate(data.oldestPendingAt)}`}</span>
        )}
        {error === null ? null : (
          <span className={META_MUTED}>The last refresh failed, so this count may be out of date.</span>
        )}
      </>
    )
  }
  if (error === null || isSessionEnded(error)) return <Skeleton height="2rem" width="3rem" />
  if (isApiError(error) && error.code === "AUTHORIZATION_DENIED") {
    return <span className={META_MUTED}>Your account cannot read nominee requests.</span>
  }
  return (
    <>
      <span className={META_MUTED}>The nominee requests could not be loaded.</span>
      <Button
        tone="secondary"
        size="sm"
        onClick={() => {
          void summary.refetch()
        }}
      >
        Try again
      </Button>
    </>
  )
}

type Props = Readonly<{ canOpen: boolean }>

export const NomineeRequestsTile = ({ canOpen }: Props): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canRead = hasAnyPermission(["users.read"])
  return (
    <Card elevated>
      <Stat label={LABEL} hint={HINT}>
        {canRead ? <PendingCount /> : <span className={META_MUTED}>Not available with your permissions.</span>}
      </Stat>
      {canRead && canOpen ? (
        <ButtonLink to="/nominee-requests" tone="ghost" size="sm" trailing>
          Open
        </ButtonLink>
      ) : null}
    </Card>
  )
}
