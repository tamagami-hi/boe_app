import { BrowserRouter } from "react-router-dom"
import type { QueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"

import { ConnectivityBanner } from "~/app/native/ConnectivityBanner"
import { DeviceLockGate } from "~/app/native/DeviceLockGate"
import { NativeBackCoordinator } from "~/app/native/NativeBackCoordinator"
import type { TransactionalBackHandler } from "~/app/native/NativeBackCoordinator"
import { SystemBarsController } from "~/app/native/SystemBarsController"
import type { BackPolicyResolver } from "~/app/native/backPolicy"
import { NetworkStatusProvider } from "~/app/providers/NetworkStatusProvider"
import { OverlayStackProvider } from "~/app/providers/OverlayStackProvider"
import { QueryProvider } from "~/app/providers/QueryProvider"
import { SessionProvider } from "~/app/providers/SessionProvider"
import type { SessionRestorer } from "~/app/providers/SessionProvider"
import { ToastProvider } from "~/app/providers/ToastProvider"
import type { SessionScope } from "~/api/session/scope"
import type { TokenStore } from "~/api/session/tokenStore"

export type AppProvidersProps = Readonly<{
  scope: SessionScope
  tokenStore: TokenStore
  restore: SessionRestorer
  backPolicy: BackPolicyResolver
  onTransactionalBack?: TransactionalBackHandler
  queryClient: QueryClient
  children: ReactNode
}>

export const AppProviders = ({
  scope,
  tokenStore,
  restore,
  backPolicy,
  onTransactionalBack,
  queryClient,
  children,
}: AppProvidersProps): React.ReactElement => (
  <BrowserRouter>
    <QueryProvider client={queryClient}>
      <NetworkStatusProvider>
        <OverlayStackProvider>
          <SessionProvider scope={scope} tokenStore={tokenStore} restore={restore}>
            <DeviceLockGate>
              <ToastProvider>
                <SystemBarsController />
                <NativeBackCoordinator
                  resolvePolicy={backPolicy}
                  {...(onTransactionalBack === undefined ? {} : { onTransactionalBack })}
                />
                <ConnectivityBanner />
                {children}
              </ToastProvider>
            </DeviceLockGate>
          </SessionProvider>
        </OverlayStackProvider>
      </NetworkStatusProvider>
    </QueryProvider>
  </BrowserRouter>
)
