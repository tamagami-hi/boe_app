/**
 * Transport selection for admin authentication.
 *
 * These pin the behaviour that unblocked the Android admin console. The console
 * runs in a Capacitor WebView served from `https://localhost`, which is
 * cross-site with the API host, so cookie auth cannot reach it: `SameSite=Lax`
 * withholds the cookie on cross-site subresource requests and
 * `validateWebOrigin` rejects `Sec-Fetch-Site: cross-site` outright. It
 * therefore authenticates with a bearer token on the admin scope's own session
 * channel.
 *
 * The risk to guard against is the bearer path quietly becoming a way around the
 * cookie path's CSRF protections, so the tests assert the precedence rule (a
 * present access cookie always wins) as well as the fallback. The channel the
 * bearer leg accepts is asserted in `adminNativeAuth.test.ts`, because that is
 * where a client token stops being admissible.
 */
import type { FastifyRequest } from "fastify"
import { describe, expect, test, vi } from "vitest"

import * as adminNativeAuthModule from "../auth/adminNativeAuth.js"
import * as webAuthModule from "../auth/webAuth.js"
import { hasPermission, requireAnyPermission, resolveAdminPrincipal, type AdminPrincipal } from "./adminAccess.js"

const asRequest = (headers: Record<string, string | undefined>): FastifyRequest =>
  ({ headers }) as unknown as FastifyRequest

/**
 * Deps stub. `resolveAdminPrincipal` only needs the permission lookup plus
 * whatever the two authenticators read; both authenticators are stubbed at the
 * module boundary below, so nothing here talks to a database.
 */
const depsWith = (roles: readonly string[], permissions: readonly string[]) =>
  ({
    database: {},
    userRepository: {
      findActiveRolesAndPermissions: vi.fn().mockResolvedValue({ roles, permissions }),
    },
  }) as never

const webActor = { userId: "user-web", sessionId: "session-web" }
const nativeActor = { userId: "user-admin-native", sessionId: "session-admin-native" }

vi.mock("../auth/webAuth.js", async () => {
  const actual = await vi.importActual<typeof webAuthModule>("../auth/webAuth.js")
  return {
    ...actual,
    authenticateWebRequest: vi.fn().mockResolvedValue({ userId: "user-web", sessionId: "session-web" }),
    readAccessCookie: (request: FastifyRequest) => {
      const cookie = request.headers.cookie
      if (typeof cookie !== "string") return undefined
      return cookie.includes("boe_access=") ? "access-cookie-value" : undefined
    },
  }
})

vi.mock("../auth/adminNativeAuth.js", () => ({
  authenticateAdminNativeRequest: vi
    .fn()
    .mockResolvedValue({ userId: "user-admin-native", sessionId: "session-admin-native" }),
}))

const { authenticateWebRequest } = webAuthModule
const { authenticateAdminNativeRequest } = adminNativeAuthModule

const captureError = (operation: () => void): Error => {
  try {
    operation()
  } catch (error) {
    if (error instanceof Error) return error
    throw error
  }
  throw new Error("Expected operation to throw")
}

describe("resolveAdminPrincipal transport selection", () => {
  test("uses the cookie transport when an access cookie is present", async () => {
    const principal = await resolveAdminPrincipal(
      asRequest({ cookie: "boe_access=abc" }),
      depsWith(["superadmin"], ["applications.read"]),
      { requireCsrf: false },
    )
    expect(principal.userId).toBe(webActor.userId)
    expect(authenticateWebRequest).toHaveBeenCalled()
  })

  test("falls back to the admin bearer transport when there is no access cookie", async () => {
    vi.mocked(authenticateAdminNativeRequest).mockClear()
    const principal = await resolveAdminPrincipal(
      asRequest({ authorization: "Bearer some-admin-native-access-token" }),
      depsWith(["superadmin"], ["applications.read"]),
      { requireCsrf: false },
    )
    expect(principal.userId).toBe(nativeActor.userId)
    expect(authenticateAdminNativeRequest).toHaveBeenCalled()
  })

  test("a present cookie takes precedence over a bearer header", async () => {
    // Belt and braces: the browser console must keep its exact previous
    // behaviour even if a stale bearer token is also sent, so the bearer path
    // can never be used to sidestep the Origin/CSRF checks.
    vi.mocked(authenticateAdminNativeRequest).mockClear()
    const principal = await resolveAdminPrincipal(
      asRequest({ cookie: "boe_access=abc", authorization: "Bearer stale" }),
      depsWith(["superadmin"], ["applications.read"]),
      { requireCsrf: true },
    )
    expect(principal.userId).toBe(webActor.userId)
    expect(authenticateAdminNativeRequest).not.toHaveBeenCalled()
  })

  test("a non-Bearer Authorization header does not select the bearer transport", async () => {
    vi.mocked(authenticateAdminNativeRequest).mockClear()
    const principal = await resolveAdminPrincipal(
      asRequest({ authorization: "Basic dXNlcjpwYXNz" }),
      depsWith(["superadmin"], ["applications.read"]),
      { requireCsrf: false },
    )
    expect(principal.userId).toBe(webActor.userId)
    expect(authenticateAdminNativeRequest).not.toHaveBeenCalled()
  })

  test("roles and permissions are read live and returned for both transports", async () => {
    const principal = await resolveAdminPrincipal(
      asRequest({ authorization: "Bearer token" }),
      depsWith(["onboarding"], ["applications.read", "applications.decide"]),
      { requireCsrf: false },
    )
    expect(principal.roles).toEqual(["onboarding"])
    expect(principal.permissions).toEqual(["applications.read", "applications.decide"])
  })
})

describe("authorization is unchanged by the transport", () => {
  const principal: AdminPrincipal = {
    userId: "u",
    sessionId: "s",
    roles: ["onboarding"],
    permissions: ["applications.read"],
  }

  test("hasPermission reports only granted codes", () => {
    expect(hasPermission(principal, "applications.read")).toBe(true)
    expect(hasPermission(principal, "finance.operate")).toBe(false)
  })

  test("requireAnyPermission admits a held permission", () => {
    expect(() => requireAnyPermission(principal, ["applications.read", "finance.read"])).not.toThrow()
  })

  test("requireAnyPermission fails closed on a missing permission", () => {
    // Defence in depth behind the channel check: an account that somehow held an
    // admin_native session without the route's permission is still refused.
    const error = captureError(() => requireAnyPermission(principal, ["finance.operate"]))
    expect(error).toMatchObject({ code: "AUTHORIZATION_DENIED", httpStatus: 403 })
  })

  test("a principal with no permissions is denied everything", () => {
    const none: AdminPrincipal = { userId: "u", sessionId: "s", roles: [], permissions: [] }
    const error = captureError(() => requireAnyPermission(none, ["applications.read"]))
    expect(error).toMatchObject({ code: "AUTHORIZATION_DENIED" })
  })
})
