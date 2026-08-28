import { getHealth, nativeLogin, nativeLogout, nativeRefresh } from "~/api/generated/operations"
import { createHttpClient } from "~/api/http"
import type { HttpClient, TransportOutcome } from "~/api/http"
import { createRefreshCoordinator } from "~/api/session/refresh"
import type { RefreshCoordinator, RefreshOutcome } from "~/api/session/refresh"
import {
  createTokenStore,
  createWebPersistence,
  purgeLegacyLocalSecrets,
} from "~/api/session/tokenStore"
import type { TokenStore } from "~/api/session/tokenStore"
import type { Principal } from "~/app/providers/SessionProvider"
import { isAndroid, isNative } from "~/platform/capacitor"
import { createSecureStoragePersistence } from "~/platform/secureStorage"

const INSTALLATION_ID_KEY = "boe.client.installationId"
const APP_VERSION = "0.1.0"
const DEVICE_NAME_FALLBACK = "BeOnEdge client"

export type ClientRuntime = Readonly<{
  tokenStore: TokenStore
  refreshCoordinator: RefreshCoordinator
  http: HttpClient
  login: (input: Readonly<{ email: string; password: string }>) => Promise<Principal>
  logout: () => Promise<void>
  restore: () => Promise<Principal | null>
  probeReachability: () => Promise<boolean>
  setOutcomeReporter: (report: (outcome: TransportOutcome) => void) => void
}>

const readInstallationId = (): string => {
  const existing = localStorage.getItem(INSTALLATION_ID_KEY)
  if (existing !== null && existing !== "") return existing
  const minted = crypto.randomUUID()
  localStorage.setItem(INSTALLATION_ID_KEY, minted)
  return minted
}

const deviceName = (): string => {
  if (typeof navigator === "undefined") return DEVICE_NAME_FALLBACK
  const platform = navigator.userAgent.slice(0, 60).trim()
  return platform === "" ? DEVICE_NAME_FALLBACK : platform
}

const principalFrom = (user: Readonly<{
  userId: string
  fullName: string
  email: string
  accountStatus: string
}>): Principal => ({
  userId: user.userId,
  fullName: user.fullName,
  email: user.email,
  roles: ["client"],
  permissions: [],
  accountState: user.accountStatus === "active" ? "active" : "suspended",
})

export const createClientRuntime = (): ClientRuntime => {
  const native = isNative()
  if (native) purgeLegacyLocalSecrets()
  const tokenStore = createTokenStore({
    persistence: native ? createSecureStoragePersistence() : createWebPersistence(),
    persistSecrets: true,
  })

  let reportOutcome: (outcome: TransportOutcome) => void = () => undefined

  const rotationId = { value: crypto.randomUUID() }

  const bareClient = createHttpClient({
    scope: "client",
    tokenStore,
    refreshCoordinator: createRefreshCoordinator(() => Promise.resolve<RefreshOutcome>("unauthenticated")),
    reportOutcome: (outcome) => {
      reportOutcome(outcome)
    },
  })

  const executeRefresh = async (): Promise<RefreshOutcome> => {
    const refreshToken = tokenStore.read("client", "refreshToken")
    if (refreshToken === null) return "unauthenticated"
    try {
      const { data } = await bareClient.request(nativeRefresh, {
        body: { refreshToken, rotationId: rotationId.value },
        unauthenticated: true,
      })
      tokenStore.update("client", {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      })
      rotationId.value = crypto.randomUUID()
      return "rotated"
    } catch {
      return "unauthenticated"
    }
  }

  const refreshCoordinator = createRefreshCoordinator(executeRefresh)

  const http = createHttpClient({
    scope: "client",
    tokenStore,
    refreshCoordinator,
    reportOutcome: (outcome) => {
      reportOutcome(outcome)
    },
  })

  const login = async (
    input: Readonly<{ email: string; password: string }>,
  ): Promise<Principal> => {
    const { data } = await http.request(nativeLogin, {
      body: {
        email: input.email,
        password: input.password,
        device: {
          installationId: readInstallationId(),
          name: deviceName(),
          platform: "android",
          appVersion: APP_VERSION,
        },
      },
      headers: { "x-client-platform": "android", "x-app-version": APP_VERSION },
      unauthenticated: true,
    })

    const principal = principalFrom(data.user)
    tokenStore.update("client", {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      principal: JSON.stringify(principal),
    })
    return principal
  }

  const logout = async (): Promise<void> => {
    const refreshToken = tokenStore.read("client", "refreshToken")
    if (refreshToken !== null) {
      try {
        await http.request(nativeLogout, {
          body: { refreshToken },
          headers: { "x-client-platform": "android", "x-app-version": APP_VERSION },
        })
      } catch {
        void 0
      }
    }
    tokenStore.clear("client")
  }

  const cachedPrincipal = (): Principal | null => {
    const raw = tokenStore.read("client", "principal")
    if (raw === null) return null
    try {
      return JSON.parse(raw) as Principal
    } catch {
      return null
    }
  }

  const restore = async (): Promise<Principal | null> => {
    const principal = cachedPrincipal()
    if (principal === null) return null
    if (tokenStore.read("client", "accessToken") !== null) return principal
    const outcome = await refreshCoordinator.refreshOnce("client")
    return outcome === "rotated" ? principal : null
  }

  const probeReachability = async (): Promise<boolean> => {
    try {
      await bareClient.request(getHealth, { unauthenticated: true, timeoutMs: 6000 })
      return true
    } catch {
      return false
    }
  }

  return {
    tokenStore,
    refreshCoordinator,
    http,
    login,
    logout,
    restore,
    probeReachability,
    setOutcomeReporter: (report) => {
      reportOutcome = report
    },
  }
}

export const clientRequiresNativeDevice = (): boolean => isNative() && !isAndroid()
