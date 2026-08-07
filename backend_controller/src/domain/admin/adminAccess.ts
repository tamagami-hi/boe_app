/**
 * Admin RBAC access resolution (spec 04 §4.5). Authentication may arrive by
 * either of two transports; authorization is identical for both, because the
 * permission set is read live from the database on every request. A role or
 * permission revocation, or a session closure, therefore denies authorization
 * immediately even while an access token still has TTL.
 *
 * Two transports exist because the console has two hosts:
 *
 *   - The browser console is served from an allow-listed beonedge.in subdomain,
 *     which is same-site with the API. It authenticates with the HttpOnly
 *     `__Host-boe_access` cookie, guarded by Origin/Sec-Fetch checks and a
 *     synchronizer CSRF token on unsafe methods.
 *
 *   - The Android admin build is a Capacitor WebView served from
 *     `https://localhost`. That is a different registrable domain from
 *     beonedge.in, so every API call is cross-site, and cookie auth cannot work
 *     there at all: `SameSite=Lax` forbids the cookie on cross-site
 *     subresource requests, browsers increasingly refuse to store it as a
 *     third-party cookie in the first place, and `validateWebOrigin` rejects
 *     `Sec-Fetch-Site: cross-site` outright. It authenticates with the same
 *     native bearer token the client app uses.
 *
 * Why accepting a bearer token here is not a weakening of the cookie rules:
 * the Origin/Sec-Fetch/CSRF machinery exists to stop a hostile page from riding
 * an *ambient* credential. A bearer token is not ambient — a hostile page
 * cannot make the browser attach it, and cannot read it from another origin's
 * storage — so those checks have nothing to protect on this path. The cookie
 * path keeps every one of them, unchanged.
 *
 * The two channels cannot be crossed: `authenticateNativeRequest` only accepts
 * a session whose `channel` is `native`, and `authenticateWebRequest` only one
 * whose `channel` is `web`, so a web access-cookie value replayed in an
 * Authorization header is rejected, and vice versa.
 */
import type { FastifyRequest } from "fastify"

import type { UserId } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import { authenticateNativeRequest } from "../auth/nativeAuth.js"
import { authenticateWebRequest, readAccessCookie, type WebAuthDeps } from "../auth/webAuth.js"

export interface AdminPrincipal {
  readonly userId: string
  readonly sessionId: string
  readonly roles: readonly string[]
  readonly permissions: readonly string[]
}

const hasBearer = (request: FastifyRequest): boolean => {
  const header = request.headers.authorization
  return typeof header === "string" && header.startsWith("Bearer ")
}

/**
 * Authenticate an admin request and load its live roles and permissions. Throws
 * the authentication/session errors raised by whichever transport applies;
 * callers then enforce the route's required permission with
 * {@link requireAnyPermission}.
 *
 * The cookie is preferred when present so the browser console keeps its exact
 * previous behaviour — including its error codes — even if a stale bearer token
 * is also sent. The bearer path is taken only when there is no access cookie to
 * use, which is precisely the Android build's situation.
 */
export const resolveAdminPrincipal = async (
  request: FastifyRequest,
  deps: WebAuthDeps,
  options: Readonly<{ requireCsrf: boolean }>,
): Promise<AdminPrincipal> => {
  const useBearer = readAccessCookie(request) === undefined && hasBearer(request)
  const actor = useBearer
    ? await authenticateNativeRequest(request, deps)
    : await authenticateWebRequest(request, deps, options)

  const { roles, permissions } = await deps.userRepository.findActiveRolesAndPermissions(
    deps.database,
    actor.userId as UserId,
  )
  return { userId: actor.userId, sessionId: actor.sessionId, roles, permissions }
}

export const hasPermission = (principal: AdminPrincipal, code: string): boolean =>
  principal.permissions.includes(code)

/** Fail closed with AUTHORIZATION_DENIED unless the principal holds one of `required`. */
export const requireAnyPermission = (principal: AdminPrincipal, required: readonly string[]): void => {
  if (!required.some((code) => principal.permissions.includes(code))) {
    throw new AppError("AUTHORIZATION_DENIED")
  }
}
