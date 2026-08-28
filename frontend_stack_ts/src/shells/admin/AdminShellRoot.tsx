import { useMemo, useState } from "react"

import { createQueryClient } from "~/app/providers/QueryProvider"
import { ApiProvider } from "~/app/providers/ApiProvider"
import { AppProviders } from "~/app/providers/AppProviders"
import { TransportReporter } from "~/app/providers/TransportReporter"
import { createBackPolicyResolver } from "~/app/native/backPolicy"
import type { BackPolicy, BackPolicyInput } from "~/app/native/backPolicy"
import {
  ADMIN_HOME_PATH,
  ADMIN_LOGIN_PATH,
  ADMIN_ROUTES,
  ADMIN_SPLASH_PATH,
} from "~/app/routing/adminRoutes"
import { buildRouter } from "~/app/routing/buildRouter"
import type { EligibilityGate, GuardTargets } from "~/app/routing/guards"
import { AuthPortProvider } from "~/features/auth/authPort"
import type { AuthPort } from "~/features/auth/authPort"
import { AdminFrame } from "~/shells/admin/AdminFrame"
import { createAdminRuntime } from "~/shells/admin/adminRuntime"

const TARGETS: GuardTargets = {
  loginPath: ADMIN_LOGIN_PATH,
  blockedPath: null,
  verifyEmailPath: null,
}

const ELIGIBILITY: EligibilityGate = { loading: false, canInvest: true }

const resolveAdminBackPolicy = createBackPolicyResolver(ADMIN_ROUTES, ADMIN_HOME_PATH)

export const backPolicy = (input: BackPolicyInput): BackPolicy => resolveAdminBackPolicy(input)

export const probeReachability = (): Promise<boolean> => createAdminRuntime().probeReachability()

const AdminShellRoot = (): React.ReactElement => {
  const [runtime] = useState(createAdminRuntime)
  const [queryClient] = useState(createQueryClient)

  const port = useMemo<AuthPort>(
    () => ({
      login: runtime.login,
      logout: runtime.logout,
      probeReachability: runtime.probeReachability,
      loginPath: ADMIN_LOGIN_PATH,
      homePath: ADMIN_HOME_PATH,
      supportPath: null,
      audienceLabel: "Administrator console",
    }),
    [runtime],
  )

  const router = useMemo(
    () =>
      buildRouter({
        manifest: ADMIN_ROUTES,
        targets: TARGETS,
        indexRedirect: ADMIN_SPLASH_PATH,
        eligibility: ELIGIBILITY,
      }),
    [],
  )

  return (
    <AppProviders
      scope="admin"
      tokenStore={runtime.tokenStore}
      restore={runtime.restore}
      backPolicy={backPolicy}
      queryClient={queryClient}
    >
      <TransportReporter bind={runtime.setOutcomeReporter} />
      <ApiProvider value={runtime.http}>
        <AuthPortProvider value={port}>
          <AdminFrame>{router}</AdminFrame>
        </AuthPortProvider>
      </ApiProvider>
    </AppProviders>
  )
}

export default AdminShellRoot
