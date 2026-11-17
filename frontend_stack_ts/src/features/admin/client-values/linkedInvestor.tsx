import { hasCode } from "~/api/errors"
import { useSession } from "~/app/providers/SessionProvider"
import { useAdminUser } from "~/features/admin/shared/adminQueries"
import { Button } from "~/ui/primitives/Button"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { PROSE_SM } from "~/ui/recipes/datalist"

import { investorLabel } from "./investorQueries"

export type LinkedInvestor = Readonly<{
  label: string
  missing: boolean
  notice: React.ReactElement | null
}>

const NAME_PERMISSIONS = ["users.read"] as const

const ROLE_NOTICE = (
  <p className={PROSE_SM}>The investor from the link is selected. Names are not available for this role.</p>
)

export const useLinkedInvestor = (userId: string, pickedLabel: string): LinkedInvestor => {
  const { hasAnyPermission } = useSession()
  const canReadNames = hasAnyPermission(NAME_PERMISSIONS)
  const needsName = userId !== "" && pickedLabel === ""
  const user = useAdminUser(needsName && canReadNames ? userId : "")

  if (!needsName) return { label: pickedLabel, missing: false, notice: null }
  if (!canReadNames || hasCode(user.error, "AUTHORIZATION_DENIED")) {
    return { label: "", missing: false, notice: ROLE_NOTICE }
  }
  if (user.data !== undefined) {
    const label = investorLabel(user.data.user)
    return { label, missing: false, notice: <p className={PROSE_SM}>{`Selected from the link: ${label}.`}</p> }
  }
  if (hasCode(user.error, "RESOURCE_NOT_FOUND")) {
    return {
      label: "",
      missing: true,
      notice: (
        <Alert tone="info" title="No investor matches the link">
          The link names an account that does not exist. Choose an investor above.
        </Alert>
      ),
    }
  }
  if (user.error != null) {
    return {
      label: "",
      missing: false,
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
  return { label: "", missing: false, notice: <Skeleton height="1rem" width="40%" /> }
}
