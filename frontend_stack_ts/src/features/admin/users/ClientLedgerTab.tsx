import { useSession } from "~/app/providers/SessionProvider"
import { EarlierGrowthPanel } from "~/features/admin/client-values/EarlierGrowthPanel"
import { LedgerEntries } from "~/features/admin/client-values/LedgerEntries"
import { RecordingCategoryPanel } from "~/features/admin/client-values/RecordingCategoryPanel"

type Props = Readonly<{ userId: string; investorLabel: string; onUnsavedHold?: (unsaved: boolean) => void }>

export const ClientLedgerTab = ({ userId, investorLabel, onUnsavedHold }: Props): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canWrite = hasAnyPermission(["client_position.write"])
  const canSplit = canWrite && hasAnyPermission(["client_values.read"])
  return (
    <>
      {canWrite ? <RecordingCategoryPanel key={`categories-${userId}`} userId={userId} investorLabel={investorLabel} /> : null}
      {canSplit ? <EarlierGrowthPanel key={`earlier-growth-${userId}`} userId={userId} investorLabel={investorLabel} /> : null}
      <LedgerEntries
        key={userId}
        userId={userId}
        investorLabel={investorLabel}
        canWrite={canWrite}
        showRecordedAt
        {...(onUnsavedHold === undefined ? {} : { onUnsavedHold })}
      />
    </>
  )
}
