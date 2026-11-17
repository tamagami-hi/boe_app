import { useSession } from "~/app/providers/SessionProvider"
import { MaturityPanel } from "~/features/admin/client-values/MaturityPanel"
import { useAdminInvestorPositions } from "~/features/admin/shared/adminQueries"
import { useFundNames } from "~/features/admin/shared/fundNames"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

type Props = Readonly<{ userId: string; investorLabel: string; onUnsavedHold?: (unsaved: boolean) => void }>

export const ClientMaturityTab = ({ userId, investorLabel, onUnsavedHold }: Props): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const positions = useAdminInvestorPositions(userId)
  const funds = useFundNames()

  return (
    <>
      {funds.notice}
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
            key={userId}
            userId={userId}
            investorLabel={investorLabel}
            canWrite={hasAnyPermission(["client_position.write"])}
            positions={data.items}
            {...(onUnsavedHold === undefined ? {} : { onUnsavedHold })}
          />
        )}
      </AsyncBoundary>
    </>
  )
}
