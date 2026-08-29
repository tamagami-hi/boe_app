import {
  clientWebLogin,
  clientWebLogout,
  clientWebRefresh,
  getClientWebCsrf,
  getHealth,
  nativeLogin,
  nativeLogout,
  nativeRefresh,
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
import { isAndroid, isNative } from "~/platform/capacitor"
import { buildClientDevice, NATIVE_COMPATIBILITY_HEADERS } from "~/platform/nativeDevice"
import { createSecureStoragePersistence } from "~/platform/secureStorage"

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

/**
 * The investor app has two transports for one API, chosen by the shell it is
 * running in.
 *
 * On Android the credentials are the native bearer pair, held in Capacitor Secure
 * Storage, which survives process death.
 *
 * In a browser they are HttpOnly cookies the document cannot read, and nothing
 * credential-shaped is persisted at all: `persistSecrets` is native-only. That is
 * not a preference. A browser SPA loses every byte of memory on each full
 * document load, so a bearer session can only survive one by living in
 * `localStorage`, where any injected script can lift the refresh token — a full
 * session-takeover primitive. The cookie session survives the same document load
 * without the document ever holding the token, which is why the cookie endpoints
 * had to exist before the `localStorage` persistence could be removed (D-037).
 */
export const createClientRuntime = (): ClientRuntime => {
  const native = isNative()
  purgeLegacyLocalSecrets()
  const tokenStore = createTokenStore({
    persistence: native ? createSecureStoragePersistence() : createWebPersistence(),
    persistSecrets: native,
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

  const executeNativeRefresh = async (): Promise<RefreshOutcome> => {
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

  /**
   * Recover the synchronizer token before rotating.
   *
   * The rotation requires the *current* CSRF token, and a mismatch is treated as
   * refresh reuse and revokes the session family. An in-memory token can be one
   * rotation behind for reasons that are nobody's fault — a second tab rotated
   * first, or a document load has not restored yet — so this reads a fresh token
   * from the session's own cookies first. `getClientWebCsrf` needs no CSRF token
   * itself and accepts the refresh cookie alone, which is exactly the state an
   * expired access cookie leaves behind.
   */
  const executeCookieRefresh = async (): Promise<RefreshOutcome> => {
    try {
      const recovered = await bareClient.request(getClientWebCsrf, { unauthenticated: true })
      const { data } = await bareClient.request(clientWebRefresh, {
        body: { rotationId: rotationId.value },
        headers: { "x-csrf-token": recovered.data.csrfToken },
        unauthenticated: true,
      })
      tokenStore.update("client", {
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
    scope: "client",
    tokenStore,
    refreshCoordinator,
    reportOutcome: (outcome) => {
      reportOutcome(outcome)
    },
  })

  const nativeSignIn = async (
    input: Readonly<{ email: string; password: string }>,
  ): Promise<Principal> => {
    const { data } = await http.request(nativeLogin, {
      body: {
        email: input.email,
        password: input.password,
        device: buildClientDevice(),
      },
      headers: NATIVE_COMPATIBILITY_HEADERS,
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

  const cookieSignIn = async (
    input: Readonly<{ email: string; password: string }>,
  ): Promise<Principal> => {
    const { data } = await http.request(clientWebLogin, {
      body: { email: input.email, password: input.password },
      unauthenticated: true,
    })
    const principal = principalFrom(data.user)
    tokenStore.update("client", {
      csrfToken: data.csrfToken,
      principal: JSON.stringify(principal),
    })
    return principal
  }

  const nativeSignOut = async (): Promise<void> => {
    const refreshToken = tokenStore.read("client", "refreshToken")
    if (refreshToken !== null) {
      try {
        await http.request(nativeLogout, {
          body: { refreshToken },
          headers: NATIVE_COMPATIBILITY_HEADERS,
        })
      } catch {
        void 0
      }
    }
    tokenStore.clear("client")
  }

  const cookieSignOut = async (): Promise<void> => {
    try {
      await http.request(clientWebLogout, {})
    } catch {
      void 0
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

  const nativeRestore = async (): Promise<Principal | null> => {
    const principal = cachedPrincipal()
    if (principal === null) return null
    if (tokenStore.read("client", "accessToken") !== null) return principal
    const outcome = await refreshCoordinator.refreshOnce("client")
    return outcome === "rotated" ? principal : null
  }

  /**
   * A document load leaves the browser with its cookies and nothing else, so the
   * session is re-established from the cookies rather than from anything the page
   * remembered. The reply carries the principal, so a cached copy is never trusted
   * as evidence of a session.
   */
  const cookieRestore = async (): Promise<Principal | null> => {
    try {
      const { data } = await http.request(getClientWebCsrf, { unauthenticated: true })
      const principal = principalFrom(data.user)
      tokenStore.update("client", {
        csrfToken: data.csrfToken,
        principal: JSON.stringify(principal),
      })
      return principal
    } catch {
      return null
    }
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

export const clientRequiresNativeDevice = (): boolean => isNative() && !isAndroid()
