import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createClientRuntime } from "~/shells/client/clientRuntime"

const ACCESS_KEY = "boe.client.accessToken"
const REFRESH_KEY = "boe.client.refreshToken"
const PRINCIPAL_KEY = "boe.client.principal"

beforeEach(() => {
  localStorage.clear()
  delete window.Capacitor
})

afterEach(() => {
  localStorage.clear()
  delete window.Capacitor
})

const asNative = (): void => {
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" }
}

const CSRF_RESPONSE = {
  ok: true,
  data: {
    user: {
      userId: "00000000-0000-4000-8000-000000000001",
      fullName: "Test Investor",
      email: "investor@example.com",
      accountStatus: "active",
    },
    csrfToken: "csrf-from-the-cookie-session",
    csrfTokenExpiresAt: "2026-01-01T00:00:00.000Z",
  },
  error: null,
  meta: {
    requestId: "00000000-0000-4000-8000-000000000002",
    timestamp: "2026-01-01T00:00:00.000Z",
  },
}

const stubFetch = (status: number, body: unknown): string[] => {
  const calls: string[] = []
  window.__BOE_API_BASE__ = "http://api.test"
  globalThis.fetch = (input: RequestInfo | URL) => {
    calls.push(input instanceof Request ? input.url : String(input))
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    )
  }
  return calls
}

describe("client runtime credential persistence", () => {
  it("keeps the principal readable in a browser", () => {
    const runtime = createClientRuntime()

    runtime.tokenStore.update("client", { principal: "{}" })

    expect(localStorage.getItem(PRINCIPAL_KEY)).toBe("{}")
  })

  it("never writes a bearer secret to localStorage in a browser", () => {
    const runtime = createClientRuntime()

    runtime.tokenStore.update("client", { accessToken: "access", refreshToken: "refresh" })

    expect(runtime.tokenStore.read("client", "accessToken")).toBe("access")
    expect(localStorage.getItem(ACCESS_KEY)).toBeNull()
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
  })

  it("purges bearer secrets an earlier build leaked into localStorage", () => {
    localStorage.setItem(ACCESS_KEY, "leaked-access")
    localStorage.setItem(REFRESH_KEY, "leaked-refresh")

    createClientRuntime()

    expect(localStorage.getItem(ACCESS_KEY)).toBeNull()
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
  })

  it("recovers no secret across a full document load, which every hard navigation performs", async () => {
    const first = createClientRuntime()
    first.tokenStore.update("client", { accessToken: "access", refreshToken: "refresh" })

    const second = createClientRuntime()
    await second.tokenStore.hydrate()

    expect(second.tokenStore.read("client", "accessToken")).toBeNull()
    expect(second.tokenStore.read("client", "refreshToken")).toBeNull()
  })

  it("does not persist bearer secrets to localStorage on a native shell either", async () => {
    asNative()
    const runtime = createClientRuntime()

    runtime.tokenStore.update("client", { accessToken: "access", refreshToken: "refresh" })
    await Promise.resolve()

    expect(localStorage.getItem(ACCESS_KEY)).toBeNull()
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
  })
})

describe("browser session recovery after a document load", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete window.__BOE_API_BASE__
  })

  it("restores the principal from the cookie session, holding no stored credential", async () => {
    const calls = stubFetch(200, CSRF_RESPONSE)
    const runtime = createClientRuntime()
    await runtime.tokenStore.hydrate()

    const principal = await runtime.restore()

    expect(calls).toEqual(["http://api.test/v1/auth/client/web/csrf"])
    expect(principal?.userId).toBe("00000000-0000-4000-8000-000000000001")
    expect(runtime.tokenStore.read("client", "csrfToken")).toBe("csrf-from-the-cookie-session")
    expect(localStorage.getItem(ACCESS_KEY)).toBeNull()
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
  })

  it("resolves anonymous when the browser presents no cookie session", async () => {
    stubFetch(401, {
      ok: false,
      data: null,
      error: {
        code: "AUTHENTICATION_REQUIRED",
        message: "Sign in to continue.",
        retryable: false,
      },
      meta: {
        requestId: "00000000-0000-4000-8000-000000000003",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    })
    const runtime = createClientRuntime()
    await runtime.tokenStore.hydrate()

    await expect(runtime.restore()).resolves.toBeNull()
  })
})


describe("transport selection", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete window.__BOE_API_BASE__
  })

  const NATIVE_LOGIN_RESPONSE = {
    ok: true,
    data: {
      user: {
        userId: "00000000-0000-4000-8000-000000000001",
        fullName: "Test Investor",
        email: "investor@example.com",
        phoneMasked: "+91******4321",
        accountStatus: "active",
      },
      accessToken: "a".repeat(120),
      accessTokenExpiresAt: "2026-01-01T00:00:00.000Z",
      refreshToken: "r".repeat(43),
      refreshTokenExpiresAt: "2026-02-01T00:00:00.000Z",
      sessionId: "00000000-0000-4000-8000-000000000004",
    },
    error: null,
    meta: {
      requestId: "00000000-0000-4000-8000-000000000002",
      timestamp: "2026-01-01T00:00:00.000Z",
    },
  }

  const COOKIE_LOGIN_RESPONSE = {
    ok: true,
    data: {
      user: CSRF_RESPONSE.data.user,
      csrfToken: "csrf-from-the-cookie-session",
      accessTokenExpiresAt: "2026-01-01T00:00:00.000Z",
      refreshTokenExpiresAt: "2026-02-01T00:00:00.000Z",
    },
    error: null,
    meta: CSRF_RESPONSE.meta,
  }

  it("signs a browser in through the cookie endpoint, holding no token afterwards", async () => {
    const calls = stubFetch(200, COOKIE_LOGIN_RESPONSE)
    const runtime = createClientRuntime()

    await runtime.login({ email: "investor@example.com", password: "Password123!" })

    expect(calls).toEqual(["http://api.test/v1/auth/client/web/login"])
    expect(runtime.tokenStore.read("client", "accessToken")).toBeNull()
    expect(runtime.tokenStore.read("client", "refreshToken")).toBeNull()
    expect(runtime.tokenStore.read("client", "csrfToken")).toBe("csrf-from-the-cookie-session")
  })

  it("signs a native shell in through the bearer endpoint and keeps the pair out of localStorage", async () => {
    asNative()
    const calls = stubFetch(200, NATIVE_LOGIN_RESPONSE)
    const runtime = createClientRuntime()

    await runtime.login({ email: "investor@example.com", password: "Password123!" })

    expect(calls).toEqual(["http://api.test/v1/auth/native/login"])
    expect(runtime.tokenStore.read("client", "refreshToken")).toBe("r".repeat(43))
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
  })
})
