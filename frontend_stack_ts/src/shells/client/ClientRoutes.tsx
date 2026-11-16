import { useMemo } from "react"

import { buildRouter } from "~/app/routing/buildRouter"
import type { EligibilityGate, GuardTargets } from "~/app/routing/guards"
import { CLIENT_ROUTES, CLIENT_SPLASH_PATH } from "~/app/routing/clientRoutes"
import { useSession } from "~/app/providers/SessionProvider"
import { EligibilityReadCheck } from "~/features/email-verification/EligibilityReadCheck"
import { useEligibility } from "~/features/shared/queries"

export type ClientRoutesProps = Readonly<{ targets: GuardTargets }>

const useClientEligibilityGate = (): EligibilityGate => {
  const session = useSession()
  const eligibility = useEligibility()
  const loading = session.status === "authenticated" && eligibility.isPending
  const canInvest = eligibility.data?.canInvest === true

  return useMemo(
    () => ({ loading, canInvest, readCheck: EligibilityReadCheck }),
    [loading, canInvest],
  )
}

export const ClientRoutes = ({ targets }: ClientRoutesProps): React.ReactElement =>
  useMemo(
    () =>
      buildRouter({
        manifest: CLIENT_ROUTES,
        targets,
        indexRedirect: CLIENT_SPLASH_PATH,
        useEligibilityGate: useClientEligibilityGate,
      }),
    [targets],
  )
