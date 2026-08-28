import { useMemo } from "react"

import { buildRouter } from "~/app/routing/buildRouter"
import type { GuardTargets } from "~/app/routing/guards"
import { CLIENT_ROUTES, CLIENT_SPLASH_PATH } from "~/app/routing/clientRoutes"
import { useSession } from "~/app/providers/SessionProvider"
import { useEligibility } from "~/features/shared/queries"

export type ClientRoutesProps = Readonly<{ targets: GuardTargets }>

export const ClientRoutes = ({ targets }: ClientRoutesProps): React.ReactElement => {
  const session = useSession()
  const eligibility = useEligibility()

  const gate = useMemo(
    () => ({
      loading: session.status === "authenticated" && eligibility.isPending,
      canInvest: eligibility.data?.canInvest === true,
    }),
    [session.status, eligibility.isPending, eligibility.data],
  )

  return buildRouter({
    manifest: CLIENT_ROUTES,
    targets,
    indexRedirect: CLIENT_SPLASH_PATH,
    eligibility: gate,
  })
}
