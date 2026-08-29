/**
 * The admin console's bearer transport: the session machinery in `nativeAuth.ts`
 * instantiated for the ADMIN scope (session channel `admin_native`).
 *
 * The console has two hosts, exactly as the investor app does, and for the
 * mirrored reason:
 *
 *   - The browser build is served from an allow-listed beonedge.in subdomain,
 *     same-site with the API, and authenticates with the HttpOnly `boe_access`
 *     cookie, guarded by Origin/Sec-Fetch checks and a synchronizer CSRF token on
 *     unsafe methods. A browser has nowhere safe to keep a bearer refresh token:
 *     the only store that survives a full document load is `localStorage`,
 *     readable by any injected script.
 *
 *   - The Android APK is a Capacitor WebView served from `https://localhost`, a
 *     different registrable domain from the API host. Every call is cross-site,
 *     so cookie auth cannot work there at all — `SameSite=Lax` withholds the
 *     cookie and `validateWebOrigin` refuses `Sec-Fetch-Site: cross-site`
 *     outright. It keeps the bearer pair in Secure Storage, which survives
 *     process death.
 *
 * Isolation from the client scope is structural, not a matter of authorization:
 * a different session channel, a separate refresh chain, and no shared session
 * row. Before this scope existed, the admin bearer path called
 * `authenticateNativeRequest`, which admits any `native` session, so a plain
 * investor's APK token satisfied admin *authentication* and was stopped only by
 * the permission check behind it. Permissions are per-user and one person can
 * hold both audiences' accounts, so authorization is the wrong layer for the
 * separation. `ADMIN_NATIVE_SCOPE` requires `admin_native` exactly, and
 * `CLIENT_NATIVE_SCOPE` requires `native` exactly.
 *
 * The principal carries roles and resolved permissions, which the client bearer
 * principal deliberately does not: the admin surface is permission-gated on both
 * sides (`RequirePermission` in the console, `requireAnyPermission` on every
 * route), and the APK needs the same permission set the cookie login returns in
 * order to render the same console. `rejectLogin` refuses an account with no
 * roles at login, so an investor cannot obtain an `admin_native` session at all
 * — the audiences are kept apart at issuance as well as at use.
 */
import type { FastifyRequest } from "fastify"

import type { Transaction, User, UserId } from "../../db/repositories.js"
import {
  authenticateBearerSession,
  type NativeAuthDeps,
  type NativeAuthScope,
  type NativeRequestAuthDeps,
} from "./nativeAuth.js"
import type { WebPrincipal } from "./webAuth.js"

const buildAdminNativePrincipal = async (
  tx: Transaction,
  deps: NativeAuthDeps,
  user: User,
): Promise<WebPrincipal> => {
  const { roles, permissions } = await deps.userRepository.findActiveRolesAndPermissions(
    tx,
    user.id as UserId,
  )
  return {
    userId: user.id,
    fullName: user.full_name,
    email: user.email_normalized,
    roles,
    permissions,
  }
}

export const ADMIN_NATIVE_SCOPE: NativeAuthScope<WebPrincipal> = {
  channel: "admin_native",
  auditCommand: "auth.admin_native_login",
  auditActorType: "admin",
  buildPrincipal: buildAdminNativePrincipal,
  // Not an admin principal. The caller still sees INVALID_CREDENTIALS, so the
  // APK does not confirm that the address is a real account.
  rejectLogin: (principal) => (principal.roles.length === 0 ? "not_authorized" : null),
}

/** The admin APK's bearer principal. */
export const authenticateAdminNativeRequest = (
  request: FastifyRequest,
  deps: NativeRequestAuthDeps,
): Promise<{ userId: string; sessionId: string }> =>
  authenticateBearerSession(request, deps, ADMIN_NATIVE_SCOPE.channel)
