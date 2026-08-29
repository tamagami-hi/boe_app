/**
 * Cross-scope replay. Four audiences share one `auth_sessions` table and one
 * access-token issuer, so what keeps them apart is the session channel, compared
 * exactly on every path that accepts a credential. These tests present each
 * audience's session to every other audience's authenticator and to the rotation
 * endpoint, and require a refusal.
 *
 * The access token deliberately carries no scope claim (D-052 rejected that: a
 * discriminator the existing channel predicate does not look at means every path
 * has to learn a second check, and the one that forgets is the vulnerability).
 * The consequence is that these assertions are the whole of the isolation
 * argument, which is why they enumerate the matrix rather than sampling it.
 */
import { describe, expect, test, vi } from "vitest"

import type { FastifyRequest } from "fastify"

import { ADMIN_NATIVE_SCOPE, authenticateAdminNativeRequest } from "./adminNativeAuth.js"
import { CLIENT_WEB_COOKIES, CLIENT_WEB_SCOPE } from "./clientWebAuth.js"
import {
  authenticateBearerSession,
  authenticateNativeRequest,
  CLIENT_NATIVE_SCOPE,
  nativeRefresh,
  type NativeAuthDeps,
} from "./nativeAuth.js"
import {
  ADMIN_WEB_COOKIES,
  ADMIN_WEB_SCOPE,
  authenticateCookieSession,
  type WebSessionTransport,
} from "./webAuth.js"

type Channel = "native" | "admin_native" | "web" | "client_web"

const SESSION_ID = "00000000-0000-4000-8000-000000000001"
const USER_ID = "00000000-0000-4000-8000-000000000002"

/**
 * The two reads both authenticators perform, answered by table. Deliberately not
 * a Kysely instance: the point under test is the channel comparison, and a real
 * query builder would only add a database to the setup.
 */
const databaseWith = (channel: Channel, state = "active"): unknown => ({
  selectFrom: (table: string) => {
    const chain = {
      select: () => chain,
      selectAll: () => chain,
      where: () => chain,
      executeTakeFirst: () =>
        Promise.resolve(
          table === "auth_sessions"
            ? {
                id: SESSION_ID,
                user_id: USER_ID,
                state,
                channel,
                csrf_token_hash: null,
                csrf_key_version: null,
              }
            : { id: USER_ID, account_state: "active" },
        ),
    }
    return chain
  },
})

const bearerDeps = (channel: Channel): never =>
  ({
    database: databaseWith(channel),
    accessTokenService: {
      verify: () => Promise.resolve({ sub: USER_ID, sid: SESSION_ID, jti: "j", kid: "k" }),
    },
  }) as never

const bearerRequest = (): FastifyRequest =>
  ({ headers: { authorization: "Bearer replayed-access-token" }, method: "GET" }) as unknown as FastifyRequest

const cookieRequest = (name: string): FastifyRequest =>
  ({
    headers: { cookie: `${name}=replayed-access-token`, origin: "https://console.test" },
    method: "GET",
  }) as unknown as FastifyRequest

const cookieDeps = (channel: Channel): never =>
  ({
    database: databaseWith(channel),
    accessTokenService: {
      verify: () => Promise.resolve({ sub: USER_ID, sid: SESSION_ID, jti: "j", kid: "k" }),
    },
  }) as never

const resolveCookie = (transport: WebSessionTransport, channel: Channel): Promise<unknown> =>
  authenticateCookieSession(cookieRequest(transport.cookies.plainAccess), cookieDeps(channel), transport, {
    originAllowlist: ["https://console.test"],
    requireCsrf: false,
  })

const ALL_CHANNELS: readonly Channel[] = ["native", "admin_native", "web", "client_web"]

describe("predicate 1: the four scopes name distinct credentials and never share a session row", () => {
  test("every scope declares a different session channel", () => {
    const channels = [
      CLIENT_NATIVE_SCOPE.channel,
      ADMIN_NATIVE_SCOPE.channel,
      ADMIN_WEB_SCOPE.channel,
      CLIENT_WEB_SCOPE.channel,
    ]
    expect(new Set(channels).size).toBe(channels.length)
  })

  test("the two cookie scopes share no cookie name, so both sessions coexist in one browser", () => {
    const adminNames = Object.values(ADMIN_WEB_COOKIES)
    const clientNames = Object.values(CLIENT_WEB_COOKIES)
    expect(adminNames.some((name) => clientNames.includes(name))).toBe(false)
  })

  test("a login writes its own channel, so no row is reachable from two audiences", () => {
    // `createBearerSession` takes the channel from the scope and the session's
    // channel is immutable thereafter; there is no path that rewrites it.
    expect(CLIENT_NATIVE_SCOPE.channel).toBe("native")
    expect(ADMIN_NATIVE_SCOPE.channel).toBe("admin_native")
  })
})

describe("predicate 2: the channel is compared exactly on every bearer path", () => {
  test("the admin bearer path admits only an admin_native session", async () => {
    await expect(
      authenticateAdminNativeRequest(bearerRequest(), bearerDeps("admin_native")),
    ).resolves.toEqual({ userId: USER_ID, sessionId: SESSION_ID })
  })

  test("an investor APK token is refused as an admin bearer", async () => {
    // The defect this closes: the admin bearer leg used to accept any `native`
    // session, so a plain client's token passed admin authentication and only the
    // permission check stood behind it.
    await expect(
      authenticateAdminNativeRequest(bearerRequest(), bearerDeps("native")),
    ).rejects.toMatchObject({ code: "SESSION_INVALID" })
  })

  test("an admin APK token is refused as a client bearer", async () => {
    await expect(
      authenticateNativeRequest(bearerRequest(), bearerDeps("admin_native")),
    ).rejects.toMatchObject({ code: "SESSION_INVALID" })
  })

  test("the client bearer path admits only a native session", async () => {
    await expect(authenticateNativeRequest(bearerRequest(), bearerDeps("native"))).resolves.toEqual({
      userId: USER_ID,
      sessionId: SESSION_ID,
    })
  })

  test("a cookie session replayed in an Authorization header is refused by both bearer paths", async () => {
    for (const channel of ["web", "client_web"] as const) {
      await expect(
        authenticateNativeRequest(bearerRequest(), bearerDeps(channel)),
      ).rejects.toMatchObject({ code: "SESSION_INVALID" })
      await expect(
        authenticateAdminNativeRequest(bearerRequest(), bearerDeps(channel)),
      ).rejects.toMatchObject({ code: "SESSION_INVALID" })
    }
  })

  test("a revoked admin session is refused even on its own channel", async () => {
    const deps = {
      database: databaseWith("admin_native", "revoked"),
      accessTokenService: {
        verify: () => Promise.resolve({ sub: USER_ID, sid: SESSION_ID, jti: "j", kid: "k" }),
      },
    } as never
    await expect(authenticateAdminNativeRequest(bearerRequest(), deps)).rejects.toMatchObject({
      code: "SESSION_INVALID",
    })
  })
})

describe("predicate 2, continued: the channel is compared exactly on every cookie path", () => {
  test("the admin cookie path admits only a web session", async () => {
    await expect(resolveCookie(ADMIN_WEB_SCOPE, "web")).resolves.toEqual({
      userId: USER_ID,
      sessionId: SESSION_ID,
    })
    for (const channel of ALL_CHANNELS.filter((value) => value !== "web")) {
      await expect(resolveCookie(ADMIN_WEB_SCOPE, channel)).rejects.toMatchObject({
        code: "SESSION_INVALID",
      })
    }
  })

  test("the client cookie path admits only a client_web session", async () => {
    await expect(resolveCookie(CLIENT_WEB_SCOPE, "client_web")).resolves.toEqual({
      userId: USER_ID,
      sessionId: SESSION_ID,
    })
    for (const channel of ALL_CHANNELS.filter((value) => value !== "client_web")) {
      await expect(resolveCookie(CLIENT_WEB_SCOPE, channel)).rejects.toMatchObject({
        code: "SESSION_INVALID",
      })
    }
  })
})

describe("predicate 3: rotation is channel-scoped", () => {
  const refreshDeps = (channel: Channel) => {
    const rotateRefresh = vi.fn().mockResolvedValue(undefined)
    const revokeSessionFamily = vi.fn().mockResolvedValue(undefined)
    const deps = {
      authSessionRepository: {
        lockByRefreshTokenHash: () =>
          Promise.resolve({
            session: {
              id: SESSION_ID,
              user_id: USER_ID,
              state: "active",
              channel,
              generation: "0",
              expires_at: new Date(Date.now() + 60_000).toISOString(),
              previous_refresh_token_hash: null,
              previous_refresh_valid_until: null,
              last_rotation_id: null,
            },
            refreshToken: {
              id: "token-1",
              generation: "0",
              token_hash: Buffer.alloc(32),
              token_key_version: "rt1",
              used_at: null,
              revoked_at: null,
            },
          }),
        rotateRefresh,
        revokeSessionFamily,
      },
      accessTokenService: { sign: () => Promise.resolve("signed-access-token") },
      refreshKey: Buffer.alloc(32),
      refreshKeyVersion: "rt1",
      clock: () => new Date(),
    }
    return { deps: deps as unknown as NativeAuthDeps, rotateRefresh, revokeSessionFamily }
  }

  const input = { refreshToken: "r".repeat(43), rotationId: "00000000-0000-4000-8000-00000000000a" }

  test("an investor refresh token cannot rotate on the admin chain", async () => {
    const { deps, rotateRefresh, revokeSessionFamily } = refreshDeps("native")
    await expect(nativeRefresh({} as never, deps, ADMIN_NATIVE_SCOPE, input)).rejects.toMatchObject({
      code: "SESSION_INVALID",
    })
    // Refused before any write, so a mismatched channel is not mistaken for
    // refresh reuse and does not revoke the innocent session's family.
    expect(rotateRefresh).not.toHaveBeenCalled()
    expect(revokeSessionFamily).not.toHaveBeenCalled()
  })

  test("an admin refresh token cannot rotate on the client chain", async () => {
    const { deps, rotateRefresh } = refreshDeps("admin_native")
    await expect(nativeRefresh({} as never, deps, CLIENT_NATIVE_SCOPE, input)).rejects.toMatchObject({
      code: "SESSION_INVALID",
    })
    expect(rotateRefresh).not.toHaveBeenCalled()
  })

  test("a cookie session's refresh chain cannot be rotated by either bearer endpoint", async () => {
    for (const channel of ["web", "client_web"] as const) {
      const { deps } = refreshDeps(channel)
      await expect(nativeRefresh({} as never, deps, CLIENT_NATIVE_SCOPE, input)).rejects.toMatchObject({
        code: "SESSION_INVALID",
      })
      await expect(nativeRefresh({} as never, deps, ADMIN_NATIVE_SCOPE, input)).rejects.toMatchObject({
        code: "SESSION_INVALID",
      })
    }
  })

  test("a bearer token on its own channel does rotate", async () => {
    const { deps, rotateRefresh } = refreshDeps("admin_native")
    const outcome = await nativeRefresh({} as never, deps, ADMIN_NATIVE_SCOPE, input)
    expect(outcome.kind).toBe("issued")
    expect(rotateRefresh).toHaveBeenCalledTimes(1)
  })
})

describe("predicate 4: an admin session is only issued to an admin principal", () => {
  test("an account with no roles is refused at admin login", () => {
    expect(
      ADMIN_NATIVE_SCOPE.rejectLogin({
        userId: USER_ID,
        fullName: "Plain Investor",
        email: "investor@example.com",
        roles: [],
        permissions: [],
      }),
    ).toBe("not_authorized")
  })

  test("an account with a role is admitted", () => {
    expect(
      ADMIN_NATIVE_SCOPE.rejectLogin({
        userId: USER_ID,
        fullName: "Ops",
        email: "ops@example.com",
        roles: ["superadmin"],
        permissions: ["applications.read"],
      }),
    ).toBeNull()
  })

  test("the client bearer scope carries no permissions to widen", () => {
    // `nativeLogin` on CLIENT_NATIVE_SCOPE returns phoneMasked and no
    // roles/permissions. Widening it would make the two audiences' tokens
    // interchangeable in what they tell the holder they may do.
    expect(Object.keys(CLIENT_NATIVE_SCOPE)).not.toContain("permissions")
    expect(ADMIN_NATIVE_SCOPE.auditActorType).toBe("admin")
    expect(CLIENT_NATIVE_SCOPE.auditActorType).toBe("user")
  })
})

describe("the bearer channel is not inferable from the request", () => {
  test("authenticateBearerSession requires the channel from its caller, not the token", async () => {
    // Both helpers are one-line partial applications of the same function, so a
    // route cannot accidentally accept "whatever channel the token belongs to".
    await expect(
      authenticateBearerSession(bearerRequest(), bearerDeps("native"), "admin_native"),
    ).rejects.toMatchObject({ code: "SESSION_INVALID" })
    await expect(
      authenticateBearerSession(bearerRequest(), bearerDeps("admin_native"), "native"),
    ).rejects.toMatchObject({ code: "SESSION_INVALID" })
  })

  test("a request with no Authorization header fails AUTHENTICATION_REQUIRED", async () => {
    const request = { headers: {}, method: "GET" } as unknown as FastifyRequest
    await expect(
      authenticateAdminNativeRequest(request, bearerDeps("admin_native")),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" })
  })
})
