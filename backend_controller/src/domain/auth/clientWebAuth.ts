/**
 * The investor app's browser transport: the cookie session machinery in
 * `webAuth.ts` instantiated for the CLIENT scope (session channel `client_web`).
 *
 * The client app has two hosts, exactly as the admin console does, and for the
 * same reason:
 *
 *   - The Android APK is a Capacitor WebView served from `https://localhost`,
 *     a different registrable domain from the API host. Every call is cross-site,
 *     so cookie auth cannot work there at all. It keeps the native bearer pair in
 *     Secure Storage.
 *
 *   - The browser build is served same-site with the API and authenticates with
 *     the HttpOnly `boe_client_access` cookie, guarded by Origin/Sec-Fetch checks
 *     and a synchronizer CSRF token on unsafe methods. A browser has nowhere safe
 *     to keep a bearer refresh token: the only store that survives a full document
 *     load is `localStorage`, readable by any injected script.
 *
 * Isolation from the admin scope is structural, not a matter of authorization:
 * different cookie names, a different CSRF token, a separate refresh chain, and a
 * session channel that each authentication path requires exactly. An admin cookie
 * resolves to a `web` session and is refused here; a client cookie resolves to
 * `client_web` and is refused by `authenticateWebRequest`.
 */
import type { FastifyRequest } from "fastify"

import { authenticateNativeRequest, type NativeRequestAuthDeps } from "./nativeAuth.js"
import {
  authenticateCookieSession,
  readAccessCookie,
  type WebAuthScope,
  type WebCookieNames,
} from "./webAuth.js"

export const CLIENT_WEB_COOKIES: WebCookieNames = {
  secureAccess: "__Host-boe_client_access",
  plainAccess: "boe_client_access",
  secureRefresh: "__Host-boe_client_refresh",
  plainRefresh: "boe_client_refresh",
}

export interface ClientWebPrincipal {
  readonly userId: string
  readonly fullName: string
  readonly email: string
  readonly accountStatus: "active"
}

/**
 * `accountStatus` is a literal because every path that produces this principal
 * has already refused a non-active account, exactly as the native session
 * response does.
 */
export const CLIENT_WEB_SCOPE: WebAuthScope<ClientWebPrincipal> = {
  channel: "client_web",
  cookies: CLIENT_WEB_COOKIES,
  auditCommand: "auth.client_web_login",
  auditActorType: "user",
  buildPrincipal: (_tx, _deps, user) =>
    Promise.resolve({
      userId: user.id,
      fullName: user.full_name,
      email: user.email_normalized,
      accountStatus: "active",
    }),
  // No requirement beyond a correct password on an active account, which is
  // precisely what `nativeLogin` asks of the same account.
  rejectLogin: () => null,
}

export interface ClientWebOriginConfig {
  readonly originAllowlist: readonly string[]
}

/** What any client-authenticated route needs to resolve its caller. */
export interface ClientRequestAuthDeps extends NativeRequestAuthDeps {
  readonly clientWeb: ClientWebOriginConfig
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * Authenticate a client request over whichever transport it arrived on.
 *
 * The client access cookie decides: present means the browser build, absent means
 * the bearer path. Absent-and-no-bearer therefore still fails with
 * AUTHENTICATION_REQUIRED from `authenticateNativeRequest`, which is what both
 * clients need — the browser's access cookie expires long before its refresh
 * cookie, and the transport only attempts a refresh on that code.
 *
 * Accepting a bearer token here does not weaken the cookie rules. The
 * Origin/Sec-Fetch/CSRF machinery exists to stop a hostile page riding an
 * *ambient* credential; a bearer token is not ambient, so those checks have
 * nothing to protect on that path. The cookie path keeps every one of them.
 *
 * CSRF is required for exactly the unsafe methods rather than being declared per
 * route: thirty-odd call sites each repeating a boolean is a defect waiting to
 * happen, and the method is the property the requirement actually follows.
 */
export const resolveClientPrincipal = async (
  request: FastifyRequest,
  deps: ClientRequestAuthDeps,
): Promise<{ userId: string; sessionId: string }> => {
  if (readAccessCookie(request, CLIENT_WEB_COOKIES) === undefined) {
    return authenticateNativeRequest(request, deps)
  }
  return authenticateCookieSession(request, deps, CLIENT_WEB_SCOPE, {
    originAllowlist: deps.clientWeb.originAllowlist,
    requireCsrf: !SAFE_METHODS.has(request.method.toUpperCase()),
  })
}
