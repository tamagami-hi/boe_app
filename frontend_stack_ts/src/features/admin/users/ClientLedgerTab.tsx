import { useSession } from "~/app/providers/SessionProvider"
import { LedgerEntries } from "~/features/admin/client-values/LedgerEntries"

type Props = Readonly<{ userId: string; investorLabel: string; onUnsavedHold?: (unsaved: boolean) => void }>

export const ClientLedgerTab = ({ userId, investorLabel, onUnsavedHold }: Props): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  return (
    <LedgerEntries
      key={userId}
      userId={userId}
      investorLabel={investorLabel}
      canWrite={hasAnyPermission(["client_position.write"])}
      showRecordedAt
      {...(onUnsavedHold === undefined ? {} : { onUnsavedHold })}
    />
  )
}
