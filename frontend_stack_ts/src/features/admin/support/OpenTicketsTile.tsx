import { isApiError, isSessionEnded } from "~/api/errors"
import { useSession } from "~/app/providers/SessionProvider"
import { Stat } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

import { ADMIN_QUEUE_COUNT } from "~/ui/recipes/admin"
import { META_MUTED } from "~/ui/recipes/text"

import { useSupportInbox } from "./supportQueries"

const COUNT_PAGE = 100
const LABEL = "Open support requests"
const HINT = "Requests nobody has picked up yet. The client sees Open until you reply."

const OpenCount = (): React.ReactElement => {
  const list = useSupportInbox("open", COUNT_PAGE)
  const { data, error } = list
  if (data !== undefined) {
    return (
      <>
        <span className={ADMIN_QUEUE_COUNT}>{`${String(data.items.length)}${list.hasMore ? "+" : ""}`}</span>
        {error === null || error === undefined ? null : (
          <span className={META_MUTED}>The last refresh failed, so this count may be out of date.</span>
        )}
      </>
    )
  }
  if (error === null || error === undefined || isSessionEnded(error)) return <Skeleton height="2rem" width="3rem" />
  if (isApiError(error) && error.code === "AUTHORIZATION_DENIED") {
    return <span className={META_MUTED}>Your account cannot read support requests.</span>
  }
  return (
    <>
      <span className={META_MUTED}>The support requests could not be loaded.</span>
      <Button tone="secondary" size="sm" onClick={list.refetch}>
        Try again
      </Button>
    </>
  )
}

export const OpenTicketsTile = (): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canRead = hasAnyPermission(["support.read"])
  return (
    <Card elevated>
      <Stat label={LABEL} hint={HINT}>
        {canRead ? <OpenCount /> : <span className={META_MUTED}>Not available with your permissions.</span>}
      </Stat>
      {canRead ? (
        <ButtonLink to="/support" tone="ghost" size="sm" trailing>
          Open
        </ButtonLink>
      ) : null}
    </Card>
  )
}
