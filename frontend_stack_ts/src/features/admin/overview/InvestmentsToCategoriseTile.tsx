import { isApiError, isSessionEnded } from "~/api/errors"
import { useSession } from "~/app/providers/SessionProvider"
import { useInvestmentsToCategorise } from "~/features/admin/client-values/investmentCleanupQueries"
import { Stat } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { ADMIN_QUEUE_COUNT } from "~/ui/recipes/admin"
import { META_MUTED } from "~/ui/recipes/text"

export const INVESTMENTS_TO_CATEGORISE_PATH = "/client-values/to-categorise"

const LABEL = "Investments to categorise"
const HINT = "Clients whose recordings need a category or whose earlier growth needs a split before their breakdown can show."

const clientCount = (count: number): string => `${String(count)} ${count === 1 ? "client" : "clients"}`

type Props = Readonly<{ canOpen: boolean }>

const Tile = ({ canOpen, children }: Readonly<{ canOpen: boolean; children: React.ReactNode }>): React.ReactElement => (
  <Card elevated>
    <Stat label={LABEL} hint={HINT}>
      {children}
    </Stat>
    {canOpen ? (
      <ButtonLink to={INVESTMENTS_TO_CATEGORISE_PATH} tone="ghost" size="sm" trailing>
        Open
      </ButtonLink>
    ) : null}
  </Card>
)

const ReadableTile = ({ canOpen }: Props): React.ReactElement | null => {
  const list = useInvestmentsToCategorise(true)
  const { data, error } = list
  if (data !== undefined) {
    if (data.clientCount === 0 && (error === null || error === undefined)) return null
    return (
      <Tile canOpen={canOpen}>
        <span className={ADMIN_QUEUE_COUNT}>{clientCount(data.clientCount)}</span>
        {error === null || error === undefined ? null : (
          <span className={META_MUTED}>The last refresh failed, so this count may be out of date.</span>
        )}
      </Tile>
    )
  }
  if (error === null || error === undefined || isSessionEnded(error)) {
    return (
      <Tile canOpen={false}>
        <Skeleton height="2rem" width="3rem" />
      </Tile>
    )
  }
  if (isApiError(error) && error.code === "AUTHORIZATION_DENIED") {
    return (
      <Tile canOpen={false}>
        <span className={META_MUTED}>Your account cannot read this.</span>
      </Tile>
    )
  }
  return (
    <Tile canOpen={false}>
      <span className={META_MUTED}>This could not be loaded.</span>
      <Button
        tone="secondary"
        size="sm"
        onClick={() => {
          list.refetch()
        }}
      >
        Try again
      </Button>
    </Tile>
  )
}

export const InvestmentsToCategoriseTile = ({ canOpen }: Props): React.ReactElement | null => {
  const { hasAnyPermission } = useSession()
  return hasAnyPermission(["client_values.read"]) ? <ReadableTile canOpen={canOpen} /> : null
}
