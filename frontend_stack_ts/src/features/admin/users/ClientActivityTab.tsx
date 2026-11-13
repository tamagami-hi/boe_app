import { useUserAuditTrail } from "~/features/admin/audit/auditQueries"
import { AuditTrailTable } from "~/features/admin/audit/AuditTrailTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

type Props = Readonly<{ userId: string }>

export const ClientActivityTab = ({ userId }: Props): React.ReactElement => {
  const trail = useUserAuditTrail(userId)
  return (
    <>
      <AsyncBoundary
        query={trail}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="45%" />
            <Skeleton height="1rem" width="70%" />
          </Card>
        }
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            title="No activity recorded"
            description="No audit record names this account, its money records or its requests yet."
          />
        }
      >
        {(data) => <AuditTrailTable caption="Activity log, newest first" rows={data.items} showClient={false} />}
      </AsyncBoundary>
      <LoadMore list={trail} noun="events" />
    </>
  )
}
