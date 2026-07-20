/**
 * Admin RBAC access resolution (spec 04 §4.5). Builds on the web-cookie
 * authentication (Origin/Sec-Fetch + session + optional synchronizer CSRF) and
 * adds the runtime permission check. Because permissions are read live on every
 * request, a role/permission revocation or session closure denies authorization
 * immediately even while an access cookie still has TTL.
 */
import type { FastifyRequest } from "fastify"

import type { UserId } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import { authenticateWebRequest, type WebAuthDeps } from "../auth/webAuth.js"

export interface AdminPrincipal {
  readonly userId: string
  readonly sessionId: string
  readonly permissions: readonly string[]
}

/**
 * Authenticate a web-cookie admin request and load its live permissions. Throws
 * the authentication/session errors from {@link authenticateWebRequest}; callers
 * then enforce the route's required permission with {@link requireAnyPermission}.
 */
export const resolveAdminPrincipal = async (
  request: FastifyRequest,
  deps: WebAuthDeps,
  options: Readonly<{ requireCsrf: boolean }>,
): Promise<AdminPrincipal> => {
  const actor = await authenticateWebRequest(request, deps, options)
  const { permissions } = await deps.userRepository.findActiveRolesAndPermissions(
    deps.database,
    actor.userId as UserId,
  )
  return { userId: actor.userId, sessionId: actor.sessionId, permissions }
}

export const hasPermission = (principal: AdminPrincipal, code: string): boolean =>
  principal.permissions.includes(code)

/** Fail closed with AUTHORIZATION_DENIED unless the principal holds one of `required`. */
export const requireAnyPermission = (principal: AdminPrincipal, required: readonly string[]): void => {
  if (!required.some((code) => principal.permissions.includes(code))) {
    throw new AppError("AUTHORIZATION_DENIED")
  }
}
