import { useSession } from "~/app/providers/SessionProvider"
import { useAdminUser } from "~/features/admin/shared/adminQueries"
import { Button } from "~/ui/primitives/Button"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { PROSE_SM } from "~/ui/recipes/datalist"

import { investorLabel } from "./investorQueries"

export type LinkedInvestor = Readonly<{
  label: string
  notice: React.ReactElement | null
}>

const NAME_PERMISSIONS = ["users.read"] as const

export const useLinkedInvestor = (userId: string, pickedLabel: string): LinkedInvestor => {
  const { hasAnyPermission } = useSession()
  const canReadNames = hasAnyPermission(NAME_PERMISSIONS)
  const needsName = userId !== "" && pickedLabel === ""
  const user = useAdminUser(needsName && canReadNames ? userId : "")

  if (!needsName) return { label: pickedLabel, notice: null }
  if (!canReadNames) {
    return {
      label: "",
      notice: (
        <p className={PROSE_SM}>
          The investor from the link is selected. Names are not available for this role.
        </p>
      ),
    }
  }
  if (user.data !== undefined) {
    const label = investorLabel(user.data.user)
    return { label, notice: <p className={PROSE_SM}>{`Selected from the link: ${label}.`}</p> }
  }
  if (user.error != null) {
    return {
      label: "",
      notice: (
        <Alert
          tone="error"
          title="Name not loaded"
          action={
            <Button
              size="sm"
              tone="secondary"
              loading={user.isFetching}
              onClick={() => {
                void user.refetch()
              }}
            >
              Try again
            </Button>
          }
        >
          The investor from the link is selected, but their name could not be read.
        </Alert>
      ),
    }
  }
  return { label: "", notice: <Skeleton height="1rem" width="40%" /> }
}
