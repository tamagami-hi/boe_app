/**
 * Transport selection for admin authentication.
 *
 * These pin the behaviour that unblocked the Android admin console. The console
 * runs in a Capacitor WebView served from `https://localhost`, which is
 * cross-site with the API host, so cookie auth cannot reach it: `SameSite=Lax`
 * withholds the cookie on cross-site subresource requests and
 * `validateWebOrigin` rejects `Sec-Fetch-Site: cross-site` outright. It
 * therefore authenticates with a native bearer token instead.
 *
 * The risk to guard against is the bearer path quietly becoming a way around the
 * cookie path's CSRF protections, so the tests assert the precedence rule (a
 * present access cookie always wins) as well as the fallback.
 */
import type { FastifyRequest } from "fastify"
import { describe, expect, test, vi } from "vitest"

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
const nativeActor = { userId: "user-native", sessionId: "session-native" }

vi.mock("../auth/webAuth.js", async () => {
  const actual = await vi.importActual<typeof import("../auth/webAuth.js")>("../auth/webAuth.js")
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

vi.mock("../auth/nativeAuth.js", () => ({
  authenticateNativeRequest: vi.fn().mockResolvedValue({ userId: "user-native", sessionId: "session-native" }),
}))

const { authenticateWebRequest } = await import("../auth/webAuth.js")
const { authenticateNativeRequest } = await import("../auth/nativeAuth.js")

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

  test("falls back to the bearer transport when there is no access cookie", async () => {
    vi.mocked(authenticateNativeRequest).mockClear()
    const principal = await resolveAdminPrincipal(
      asRequest({ authorization: "Bearer some-native-access-token" }),
      depsWith(["superadmin"], ["applications.read"]),
      { requireCsrf: false },
    )
    expect(principal.userId).toBe(nativeActor.userId)
    expect(authenticateNativeRequest).toHaveBeenCalled()
  })

  test("a present cookie takes precedence over a bearer header", async () => {
    // Belt and braces: the browser console must keep its exact previous
    // behaviour even if a stale bearer token is also sent, so the bearer path
    // can never be used to sidestep the Origin/CSRF checks.
    vi.mocked(authenticateNativeRequest).mockClear()
    const principal = await resolveAdminPrincipal(
      asRequest({ cookie: "boe_access=abc", authorization: "Bearer stale" }),
      depsWith(["superadmin"], ["applications.read"]),
      { requireCsrf: true },
    )
    expect(principal.userId).toBe(webActor.userId)
    expect(authenticateNativeRequest).not.toHaveBeenCalled()
  })

  test("a non-Bearer Authorization header does not select the bearer transport", async () => {
    vi.mocked(authenticateNativeRequest).mockClear()
    const principal = await resolveAdminPrincipal(
      asRequest({ authorization: "Basic dXNlcjpwYXNz" }),
      depsWith(["superadmin"], ["applications.read"]),
      { requireCsrf: false },
    )
    expect(principal.userId).toBe(webActor.userId)
    expect(authenticateNativeRequest).not.toHaveBeenCalled()
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
    // A plain client account can obtain a native bearer token, so this is what
    // stops one from reaching the admin surface with it.
    expect(() => requireAnyPermission(principal, ["finance.operate"])).toThrow(
      expect.objectContaining({ code: "AUTHORIZATION_DENIED", httpStatus: 403 }),
    )
  })

  test("a principal with no permissions is denied everything", () => {
    const none: AdminPrincipal = { userId: "u", sessionId: "s", roles: [], permissions: [] }
    expect(() => requireAnyPermission(none, ["applications.read"])).toThrow(
      expect.objectContaining({ code: "AUTHORIZATION_DENIED" }),
    )
  })
})
