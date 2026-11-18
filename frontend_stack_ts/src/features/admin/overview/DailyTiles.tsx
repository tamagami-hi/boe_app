import type { ReactNode } from "react"

import { isApiError, isSessionEnded } from "~/api/errors"
import { ContentGrid } from "~/app/layouts/ContentGrid"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDate, formatDateTime } from "~/domain/dates"
import { NomineeRequestsTile } from "~/features/admin/nominee-requests/NomineeRequestsTile"
import { OpenTicketsTile } from "~/features/admin/support/OpenTicketsTile"
import { DataList, DetailRow, Stat } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { ADMIN_QUEUE_COUNT } from "~/ui/recipes/admin"
import { META_MUTED } from "~/ui/recipes/text"

import { INVESTMENTS_TO_CATEGORISE_PATH, InvestmentsToCategoriseTile } from "./InvestmentsToCategoriseTile"
import { useFailedEmails, useFundValueUpdates, usePendingInvites } from "./overviewQueries"

type Readable<TData> = Readonly<{ data: TData | undefined; error: unknown; refetch: () => unknown }>

const NO_PERMISSION = <span className={META_MUTED}>Not available with your permissions.</span>

const TileReading = <TData,>({
  query,
  render,
}: Readonly<{ query: Readable<TData>; render: (data: TData) => ReactNode }>): React.ReactElement => {
  const { data, error } = query
  if (data !== undefined) {
    return (
      <>
        {render(data)}
        {error === null || error === undefined ? null : (
          <span className={META_MUTED}>The last refresh failed, so this may be out of date.</span>
        )}
      </>
    )
  }
  if (error === null || error === undefined || isSessionEnded(error)) return <Skeleton height="2rem" width="3rem" />
  if (isApiError(error) && error.code === "AUTHORIZATION_DENIED") {
    return <span className={META_MUTED}>Your account cannot read this.</span>
  }
  return (
    <>
      <span className={META_MUTED}>This could not be loaded.</span>
      <Button
        tone="secondary"
        size="sm"
        onClick={() => {
          void query.refetch()
        }}
      >
        Try again
      </Button>
    </>
  )
}

type TileProps = Readonly<{
  label: string
  hint: string
  to: string
  canOpen: boolean
  children: ReactNode
}>

const DailyTile = ({ label, hint, to, canOpen, children }: TileProps): React.ReactElement => (
  <Card elevated>
    <Stat label={label} hint={hint}>
      {children}
    </Stat>
    {canOpen ? (
      <ButtonLink to={to} tone="ghost" size="sm" trailing>
        Open
      </ButtonLink>
    ) : null}
  </Card>
)

type Props = Readonly<{ reachablePaths: ReadonlySet<string> }>

export const DailyTiles = ({ reachablePaths }: Props): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canReadInvites = hasAnyPermission(["users.read", "clients.password_links.send"])
  const canReadEmails = hasAnyPermission(["email_deliveries.read", "email_deliveries.read_masked"])
  const canReadValues = hasAnyPermission(["client_values.read"])
  const invites = usePendingInvites(canReadInvites)
  const failedEmails = useFailedEmails(canReadEmails)
  const fundUpdates = useFundValueUpdates(canReadValues)

  return (
    <Section title="Today" description="What needs a follow-up across clients, up to date when you open this page.">
      <ContentGrid columns={4}>
        <DailyTile
          label="Invites not accepted"
          hint="Clients who have not set a password yet. Open a client to send a new invite link."
          to="/users?segment=pending_invites"
          canOpen={reachablePaths.has("/users")}
        >
          {canReadInvites ? (
            <TileReading
              query={invites}
              render={(data) => (
                <>
                  <span className={ADMIN_QUEUE_COUNT}>{String(data.count)}</span>
                  {data.oldestInvitedAt === null ? null : (
                    <span className={META_MUTED}>{`Oldest created ${formatDate(data.oldestInvitedAt)}`}</span>
                  )}
                </>
              )}
            />
          ) : (
            NO_PERMISSION
          )}
        </DailyTile>

        <DailyTile
          label="Failed emails"
          hint="Deliveries the mail provider refused for good. They are not retried."
          to="/emails?state=permanent_failed"
          canOpen={reachablePaths.has("/emails")}
        >
          {canReadEmails ? (
            <TileReading
              query={failedEmails}
              render={(data) => (
                <span className={ADMIN_QUEUE_COUNT}>{`${String(data.items.length)}${failedEmails.hasMore ? "+" : ""}`}</span>
              )}
            />
          ) : (
            NO_PERMISSION
          )}
        </DailyTile>

        <DailyTile
          label="Last value update per fund"
          hint="When a client value update was last recorded in each fund."
          to="/client-values"
          canOpen={reachablePaths.has("/client-values")}
        >
          {canReadValues ? (
            <TileReading
              query={fundUpdates}
              render={(data) =>
                data.items.length === 0 ? (
                  <span className={META_MUTED}>No fund is open yet.</span>
                ) : (
                  <DataList>
                    {data.items.map((fund) => (
                      <DetailRow key={fund.fundId} label={fund.fundName ?? fund.fundSlug}>
                        {fund.lastValueUpdateAt === null ? "No value update yet" : formatDateTime(fund.lastValueUpdateAt)}
                      </DetailRow>
                    ))}
                  </DataList>
                )
              }
            />
          ) : (
            NO_PERMISSION
          )}
        </DailyTile>

        <OpenTicketsTile canOpen={reachablePaths.has("/support")} />

        <NomineeRequestsTile canOpen={reachablePaths.has("/nominee-requests")} />

        <InvestmentsToCategoriseTile canOpen={reachablePaths.has(INVESTMENTS_TO_CATEGORISE_PATH)} />
      </ContentGrid>
    </Section>
  )
}
