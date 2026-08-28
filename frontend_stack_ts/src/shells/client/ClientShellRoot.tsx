import { useMemo, useState } from "react"

import { createQueryClient } from "~/app/providers/QueryProvider"
import { ApiProvider } from "~/app/providers/ApiProvider"
import { AppProviders } from "~/app/providers/AppProviders"
import { TransportReporter } from "~/app/providers/TransportReporter"
import { createBackPolicyResolver } from "~/app/native/backPolicy"
import type { BackPolicy, BackPolicyInput } from "~/app/native/backPolicy"
import {
  CLIENT_BLOCKED_PATH,
  CLIENT_HOME_PATH,
  CLIENT_LOGIN_PATH,
  CLIENT_ROUTES,
  CLIENT_SUPPORT_PATH,
  CLIENT_VERIFY_EMAIL_PATH,
} from "~/app/routing/clientRoutes"
import type { GuardTargets } from "~/app/routing/guards"
import { AuthPortProvider } from "~/features/auth/authPort"
import type { AuthPort } from "~/features/auth/authPort"
import { ClientFrame } from "~/shells/client/ClientFrame"
import { ClientRoutes } from "~/shells/client/ClientRoutes"
import { createClientRuntime } from "~/shells/client/clientRuntime"

const TARGETS: GuardTargets = {
  loginPath: CLIENT_LOGIN_PATH,
  blockedPath: CLIENT_BLOCKED_PATH,
  verifyEmailPath: CLIENT_VERIFY_EMAIL_PATH,
}

const resolveClientBackPolicy = createBackPolicyResolver(CLIENT_ROUTES, CLIENT_HOME_PATH)

export const backPolicy = (input: BackPolicyInput): BackPolicy => resolveClientBackPolicy(input)

export const probeReachability = (): Promise<boolean> => createClientRuntime().probeReachability()

const confirmTransactionalBack = (): boolean =>
  !window.confirm("Leave this screen? Your entry will not be submitted.")

const ClientShellRoot = (): React.ReactElement => {
  const [runtime] = useState(createClientRuntime)
  const [queryClient] = useState(createQueryClient)

  const port = useMemo<AuthPort>(
    () => ({
      login: runtime.login,
      logout: runtime.logout,
      probeReachability: runtime.probeReachability,
      loginPath: CLIENT_LOGIN_PATH,
      homePath: CLIENT_HOME_PATH,
      supportPath: CLIENT_SUPPORT_PATH,
      audienceLabel: "Investing, made deliberate",
    }),
    [runtime],
  )

  return (
    <AppProviders
      scope="client"
      tokenStore={runtime.tokenStore}
      restore={runtime.restore}
      backPolicy={backPolicy}
      onTransactionalBack={confirmTransactionalBack}
      queryClient={queryClient}
    >
      <TransportReporter bind={runtime.setOutcomeReporter} />
      <ApiProvider value={runtime.http}>
        <AuthPortProvider value={port}>
          <ClientFrame>
            <ClientRoutes targets={TARGETS} />
          </ClientFrame>
        </AuthPortProvider>
      </ApiProvider>
    </AppProviders>
  )
}

export default ClientShellRoot
