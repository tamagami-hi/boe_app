import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { submitClientReview } from "~/api/generated/operations"
import { SESSION_INVALIDATED_EVENT } from "~/api/session/scope"
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

type Reply = readonly [status: number, body: unknown]

type Sent = Readonly<{ route: string; headers: Headers }>

const NOT_FOUND: Reply = [404, { ok: false, data: null, error: { code: "RESOURCE_NOT_FOUND", message: "Not found.", retryable: false }, meta: CSRF_RESPONSE.meta }]

const routeFetch = (routes: Readonly<Record<string, readonly Reply[]>>): Sent[] => {
  const sent: Sent[] = []
  const answered = new Map<string, number>()
  window.__BOE_API_BASE__ = "http://api.test"
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    const route = `${init?.method ?? "GET"} ${new URL(url).pathname}`
    sent.push({ route, headers: new Headers(init?.headers) })
    const replies = routes[route] ?? []
    const index = answered.get(route) ?? 0
    answered.set(route, index + 1)
    const [status, body] = replies[Math.min(index, replies.length - 1)] ?? NOT_FOUND
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }))
  }
  return sent
}

const listenForSessionEnd = (): (() => readonly unknown[]) => {
  const seen: unknown[] = []
  const listener = (event: Event): void => {
    seen.push((event as CustomEvent<unknown>).detail)
  }
  window.addEventListener(SESSION_INVALIDATED_EVENT, listener)
  return () => {
    window.removeEventListener(SESSION_INVALIDATED_EVENT, listener)
    return seen
  }
}

type Investor = typeof CSRF_RESPONSE.data.user

const INVESTOR: Investor = CSRF_RESPONSE.data.user
const OTHER_INVESTOR: Investor = {
  ...INVESTOR,
  userId: "00000000-0000-4000-8000-0000000000c2",
  fullName: "Other Investor",
  email: "other@example.com",
}

const csrfFor = (user: Investor): unknown => ({ ...CSRF_RESPONSE, data: { ...CSRF_RESPONSE.data, user } })

const refreshedAs = (user: Investor): unknown => ({
  ok: true,
  data: {
    user,
    csrfToken: `rotated-csrf-of-${user.userId}`,
    accessTokenExpiresAt: "2026-01-01T00:00:00.000Z",
    refreshTokenExpiresAt: "2026-02-01T00:00:00.000Z",
  },
  error: null,
  meta: CSRF_RESPONSE.meta,
})

const EXPIRED: Reply = [401, { ok: false, data: null, error: { code: "AUTHENTICATION_REQUIRED", message: "Sign in to continue.", retryable: false }, meta: CSRF_RESPONSE.meta }]

const SUBMITTED: Reply = [
  201,
  {
    ok: true,
    data: { id: "00000000-0000-4000-8000-0000000000d1", rating: 5, comment: null, submittedAt: "2026-01-01T00:00:00.000Z" },
    error: null,
    meta: CSRF_RESPONSE.meta,
  },
]

const REVIEW = "POST /v1/client/reviews"
const CSRF = "GET /v1/auth/client/web/csrf"
const REFRESH = "POST /v1/auth/client/web/refresh"

const signedInTab = (): ReturnType<typeof createClientRuntime> => {
  const runtime = createClientRuntime()
  runtime.tokenStore.update("client", { csrfToken: "csrf-of-the-tab", principal: JSON.stringify(INVESTOR) })
  return runtime
}

const submitReview = (runtime: ReturnType<typeof createClientRuntime>) =>
  runtime.http.request(submitClientReview, { body: { rating: 5, comment: null } })

describe("client cookie refresh after another client signs in to the browser", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete window.__BOE_API_BASE__
  })

  it("ends the tab's session without rotating the other client's session or resending the write as them", async () => {
    const sent = routeFetch({ [REVIEW]: [EXPIRED, SUBMITTED], [CSRF]: [[200, csrfFor(OTHER_INVESTOR)]], [REFRESH]: [[200, refreshedAs(OTHER_INVESTOR)]] })
    const ended = listenForSessionEnd()
    const runtime = signedInTab()

    await expect(submitReview(runtime)).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" })

    expect(sent.map(({ route }) => route)).toEqual([REVIEW, CSRF])
    expect(ended()).toEqual([{ scope: "client", reason: "revoked" }])
    expect(runtime.tokenStore.read("client", "principal")).toBeNull()
    expect(runtime.tokenStore.read("client", "csrfToken")).toBeNull()
  })

  it("resends the write once when the refresh returns the client the tab holds", async () => {
    const sent = routeFetch({ [REVIEW]: [EXPIRED, SUBMITTED], [CSRF]: [[200, csrfFor(INVESTOR)]], [REFRESH]: [[200, refreshedAs(INVESTOR)]] })
    const ended = listenForSessionEnd()
    const runtime = signedInTab()

    const { data } = await submitReview(runtime)

    expect(data.rating).toBe(5)
    expect(sent.map(({ route }) => route)).toEqual([REVIEW, CSRF, REFRESH, REVIEW])
    expect(sent.at(-1)?.headers.get("x-csrf-token")).toBe(`rotated-csrf-of-${INVESTOR.userId}`)
    expect(ended()).toEqual([])
    expect(JSON.parse(runtime.tokenStore.read("client", "principal") ?? "null")).toMatchObject({ userId: INVESTOR.userId })
  })
})
