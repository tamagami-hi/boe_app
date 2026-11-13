import { useSession } from "~/app/providers/SessionProvider"
import { MaturityPanel } from "~/features/admin/client-values/MaturityPanel"
import { useAdminInvestorPositions } from "~/features/admin/shared/adminQueries"
import { useAdminFundCatalogue } from "~/features/admin/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

type Props = Readonly<{ userId: string }>

export const ClientMaturityTab = ({ userId }: Props): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const positions = useAdminInvestorPositions(userId)
  const funds = useAdminFundCatalogue()

  const fundName = (id: string): string => {
    const fund = (funds.data?.items ?? []).find((entry) => entry.id === id)
    return fund?.name ?? fund?.slug ?? id
  }

  return (
    <AsyncBoundary
      query={positions}
      skeleton={
        <Card>
          <Skeleton height="1rem" width="45%" />
          <Skeleton height="2rem" />
        </Card>
      }
    >
      {(data) => (
        <MaturityPanel
          userId={userId}
          canWrite={hasAnyPermission(["client_position.write"])}
          positions={data.items}
          fundName={fundName}
        />
      )}
    </AsyncBoundary>
  )
}
