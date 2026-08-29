import {
  adminNativeLogin,
  adminNativeLogout,
  adminNativeRefresh,
  getAdminSession,
  getHealth,
  getWebCsrf,
  webLogin,
  webLogout,
  webRefresh,
} from "~/api/generated/operations"
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
import { isPermissionCode } from "~/domain/permissions"
import type { PermissionCode, RoleCode } from "~/domain/permissions"
import { isNative } from "~/platform/capacitor"
import { buildAdminDevice, NATIVE_COMPATIBILITY_HEADERS } from "~/platform/nativeDevice"
import { createSecureStoragePersistence } from "~/platform/secureStorage"

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

/**
 * The console has two transports for one API, chosen by the shell it is running
 * in — the same split `createClientRuntime` makes, in the same order.
 *
 * On Android the credentials are the admin bearer pair, held in Capacitor Secure
 * Storage, which survives process death. That is not a preference either: the
 * APK is served from `https://localhost`, cross-site with the API, so
 * `SameSite=Lax` withholds the cookie and the backend's `Sec-Fetch-Site` gate
 * refuses the request outright. Cookie auth cannot work there at all, which is
 * why the admin APK could not sign in before the admin native endpoints existed.
 *
 * In a browser they are HttpOnly cookies the document cannot read, and nothing
 * credential-shaped is persisted: `persistSecrets` is native-only. A browser SPA
 * loses every byte of memory on each full document load, so a bearer session
 * could only survive one by living in `localStorage`, where any injected script
 * can lift the refresh token.
 *
 * The bearer pair is issued on the `admin_native` session channel, which no
 * client path accepts and which the admin cookie path does not accept either, so
 * neither audience's credential works as the other's.
 */
export const createAdminRuntime = (): AdminRuntime => {
  const native = isNative()
  purgeLegacyLocalSecrets()
  const tokenStore = createTokenStore({
    persistence: native ? createSecureStoragePersistence() : createWebPersistence(),
    persistSecrets: native,
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

  const executeNativeRefresh = async (): Promise<RefreshOutcome> => {
    const refreshToken = tokenStore.read("admin", "refreshToken")
    if (refreshToken === null) return "unauthenticated"
    try {
      const { data } = await bareClient.request(adminNativeRefresh, {
        body: { refreshToken, rotationId: rotationId.value },
        headers: NATIVE_COMPATIBILITY_HEADERS,
        unauthenticated: true,
      })
      tokenStore.update("admin", {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      })
      rotationId.value = crypto.randomUUID()
      return "rotated"
    } catch {
      return "unauthenticated"
    }
  }

  /**
   * Recover the synchronizer token before rotating.
   *
   * The rotation requires the *current* CSRF token, and a mismatch is treated as
   * refresh reuse and revokes the session family. An in-memory token can be one
   * rotation behind for reasons that are nobody's fault — a second tab rotated
   * first, or a document load has not restored yet — so this reads a fresh token
   * from the session's own cookies first. `getWebCsrf` needs no CSRF token itself
   * and accepts the refresh cookie alone, which is exactly the state an expired
   * access cookie leaves behind.
   *
   * A refresh request must also carry the token: `unauthenticated: true` keeps the
   * transport from recursing into recovery, and that same flag suppresses the
   * automatic `x-csrf-token` header, so it is passed explicitly. Without it the
   * refresh was answered CSRF_INVALID and the console signed the operator out
   * rather than rotating.
   */
  const executeCookieRefresh = async (): Promise<RefreshOutcome> => {
    try {
      const recovered = await bareClient.request(getWebCsrf, { unauthenticated: true })
      const { data } = await bareClient.request(webRefresh, {
        body: { rotationId: rotationId.value },
        headers: { "x-csrf-token": recovered.data.csrfToken },
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

  const refreshCoordinator = createRefreshCoordinator(
    native ? executeNativeRefresh : executeCookieRefresh,
  )

  const http = createHttpClient({
    scope: "admin",
    tokenStore,
    refreshCoordinator,
    reportOutcome: (outcome) => {
      reportOutcome(outcome)
    },
  })

  const nativeSignIn = async (
    input: Readonly<{ email: string; password: string }>,
  ): Promise<Principal> => {
    const { data } = await http.request(adminNativeLogin, {
      body: {
        email: input.email,
        password: input.password,
        device: buildAdminDevice(),
      },
      headers: NATIVE_COMPATIBILITY_HEADERS,
      unauthenticated: true,
    })
    const principal = principalFrom(data.user)
    tokenStore.update("admin", {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      principal: JSON.stringify(principal),
    })
    return principal
  }

  const cookieSignIn = async (
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

  const nativeSignOut = async (): Promise<void> => {
    const refreshToken = tokenStore.read("admin", "refreshToken")
    if (refreshToken !== null) {
      try {
        await http.request(adminNativeLogout, {
          body: { refreshToken },
          headers: NATIVE_COMPATIBILITY_HEADERS,
        })
      } catch {
        void 0
      }
    }
    tokenStore.clear("admin")
  }

  const cookieSignOut = async (): Promise<void> => {
    try {
      await http.request(webLogout, {})
    } catch {
      void 0
    }
    tokenStore.clear("admin")
  }

  const cachedPrincipal = (): Principal | null => {
    const raw = tokenStore.read("admin", "principal")
    if (raw === null) return null
    try {
      return JSON.parse(raw) as Principal
    } catch {
      return null
    }
  }

  /**
   * Secure Storage holds the bearer pair across process death, so the APK
   * re-establishes the session from what it kept rather than from a cookie. The
   * cached principal is only a render hint: `getAdminSession` is the authority on
   * the permission set, and it is read live so a revoked role takes effect on the
   * next start.
   */
  const nativeRestore = async (): Promise<Principal | null> => {
    if (cachedPrincipal() === null) return null
    if (tokenStore.read("admin", "accessToken") === null) {
      const outcome = await refreshCoordinator.refreshOnce("admin")
      if (outcome !== "rotated") return null
    }
    try {
      const { data } = await http.request(getAdminSession, {})
      const principal = principalFrom(data)
      tokenStore.set("admin", "principal", JSON.stringify(principal))
      return principal
    } catch {
      return null
    }
  }

  const cookieRestore = async (): Promise<Principal | null> => {
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
    login: native ? nativeSignIn : cookieSignIn,
    logout: native ? nativeSignOut : cookieSignOut,
    restore: native ? nativeRestore : cookieRestore,
    probeReachability,
    setOutcomeReporter: (report) => {
      reportOutcome = report
    },
  }
}
