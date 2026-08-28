import { getAdminSession, getHealth, getWebCsrf, webLogin, webLogout, webRefresh } from "~/api/generated/operations"
import { createHttpClient } from "~/api/http"
import type { HttpClient, TransportOutcome } from "~/api/http"
import { createRefreshCoordinator } from "~/api/session/refresh"
import type { RefreshCoordinator, RefreshOutcome } from "~/api/session/refresh"
import { createTokenStore, createWebPersistence } from "~/api/session/tokenStore"
import type { TokenStore } from "~/api/session/tokenStore"
import type { Principal } from "~/app/providers/SessionProvider"
import { isPermissionCode } from "~/domain/permissions"
import type { PermissionCode, RoleCode } from "~/domain/permissions"

export type AdminRuntime = Readonly<{
  tokenStore: TokenStore
  refreshCoordinator: RefreshCoordinator
  http: HttpClient
  login: (input: Readonly<{ email: string; password: string }>) => Promise<Principal>
  logout: () => Promise<void>
  restore: () => Promise<Principal | null>
  probeReachability: () => Promise<boolean>
  setOutcomeReporter: (report: (outcome: TransportOutcome) => void) => void
}>

const toPermissions = (values: readonly string[]): readonly PermissionCode[] =>
  values.filter(isPermissionCode)

const toRoles = (values: readonly string[]): readonly RoleCode[] =>
  values.filter((value): value is RoleCode =>
    value === "client" || value === "admin" || value === "superadmin",
  )

const principalFrom = (
  user: Readonly<{
    userId: string
    fullName: string
    email: string
    roles: readonly string[]
    permissions: readonly string[]
  }>,
): Principal => ({
  userId: user.userId,
  fullName: user.fullName,
  email: user.email,
  roles: toRoles(user.roles),
  permissions: toPermissions(user.permissions),
  accountState: "active",
})

export const createAdminRuntime = (): AdminRuntime => {
  const tokenStore = createTokenStore({
    persistence: createWebPersistence(),
    persistSecrets: false,
    purgeLegacySecrets: true,
  })

  let reportOutcome: (outcome: TransportOutcome) => void = () => undefined

  const rotationId = { value: crypto.randomUUID() }

  const bareClient = createHttpClient({
    scope: "admin",
    tokenStore,
    refreshCoordinator: createRefreshCoordinator(() =>
      Promise.resolve<RefreshOutcome>("unauthenticated"),
    ),
    reportOutcome: (outcome) => {
      reportOutcome(outcome)
    },
  })

  const executeRefresh = async (): Promise<RefreshOutcome> => {
    try {
      const { data } = await bareClient.request(webRefresh, {
        body: { rotationId: rotationId.value },
        unauthenticated: true,
      })
      tokenStore.update("admin", {
        csrfToken: data.csrfToken,
        principal: JSON.stringify(principalFrom(data.user)),
      })
      rotationId.value = crypto.randomUUID()
      return "rotated"
    } catch {
      return "unauthenticated"
    }
  }

  const refreshCoordinator = createRefreshCoordinator(executeRefresh)

  const http = createHttpClient({
    scope: "admin",
    tokenStore,
    refreshCoordinator,
    reportOutcome: (outcome) => {
      reportOutcome(outcome)
    },
  })

  const login = async (
    input: Readonly<{ email: string; password: string }>,
  ): Promise<Principal> => {
    const { data } = await http.request(webLogin, {
      body: { email: input.email, password: input.password },
      unauthenticated: true,
    })
    const principal = principalFrom(data.user)
    tokenStore.update("admin", {
      csrfToken: data.csrfToken,
      principal: JSON.stringify(principal),
    })
    return principal
  }

  const logout = async (): Promise<void> => {
    try {
      await http.request(webLogout, {})
    } catch {
      void 0
    }
    tokenStore.clear("admin")
  }

  const restore = async (): Promise<Principal | null> => {
    try {
      const { data } = await http.request(getWebCsrf, { unauthenticated: true })
      tokenStore.set("admin", "csrfToken", data.csrfToken)
    } catch {
      return null
    }

    const { data } = await http.request(getAdminSession, {})
    const principal = principalFrom(data)
    tokenStore.set("admin", "principal", JSON.stringify(principal))
    return principal
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
