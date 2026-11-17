import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { archiveAdminFaq, getAdminSession } from "~/api/generated/operations"
import { mintIdempotencyKey } from "~/api/idempotency"
import { SESSION_INVALIDATED_EVENT } from "~/api/session/scope"
import { keepHeldRecording, loadHeldRecordings } from "~/features/admin/payment-sheet/heldRecordings"
import { MONTHLY_REASON } from "~/features/admin/payment-sheet/recordingSheet"
import { keepHold, loadHold } from "~/features/admin/shared/heldWriteStore"
import { createAdminRuntime } from "~/shells/admin/adminRuntime"
import type { AdminRuntime } from "~/shells/admin/adminRuntime"

const ACCESS_KEY = "boe.admin.accessToken"
const PRINCIPAL_KEY = "boe.admin.principal"
const REFRESH_KEY = "boe.admin.refreshToken"
const INSTALLATION_KEY = "boe.admin.installationId"
const CLIENT_INSTALLATION_KEY = "boe.client.installationId"

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

const META = {
  requestId: "00000000-0000-4000-8000-000000000002",
  timestamp: "2026-01-01T00:00:00.000Z",
}

const OPERATOR = {
  userId: "00000000-0000-4000-8000-000000000001",
  fullName: "Test Operator",
  email: "ops@example.com",
  roles: ["superadmin"],
  permissions: ["applications.read"],
}

const NATIVE_LOGIN_RESPONSE = {
  ok: true,
  data: {
    user: OPERATOR,
    accessToken: "a".repeat(120),
    accessTokenExpiresAt: "2026-01-01T00:00:00.000Z",
    refreshToken: "r".repeat(43),
    refreshTokenExpiresAt: "2026-02-01T00:00:00.000Z",
    sessionId: "00000000-0000-4000-8000-000000000004",
  },
  error: null,
  meta: META,
}

const COOKIE_LOGIN_RESPONSE = {
  ok: true,
  data: {
    user: OPERATOR,
    csrfToken: "csrf-from-the-cookie-session",
    accessTokenExpiresAt: "2026-01-01T00:00:00.000Z",
    refreshTokenExpiresAt: "2026-02-01T00:00:00.000Z",
  },
  error: null,
  meta: META,
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

describe("admin transport selection", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete window.__BOE_API_BASE__
  })

  it("signs a browser in through the cookie endpoint, holding no bearer token", async () => {
    const calls = stubFetch(200, COOKIE_LOGIN_RESPONSE)
    const runtime = createAdminRuntime()

    const principal = await runtime.login({ email: "ops@example.com", password: "Password123!" })

    expect(calls).toEqual(["http://api.test/v1/auth/web/login"])
    expect(principal.permissions).toEqual(["applications.read"])
    expect(runtime.tokenStore.read("admin", "accessToken")).toBeNull()
    expect(runtime.tokenStore.read("admin", "csrfToken")).toBe("csrf-from-the-cookie-session")
  })

  it("signs a native shell in through the admin bearer endpoint, not the client one", async () => {
    // The APK is served from https://localhost, cross-site with the API, so the
    // cookie endpoints cannot reach it. It must be the admin scope's own bearer
    // endpoint: the client one issues a `native` session, which no admin route
    // accepts.
    asNative()
    const calls = stubFetch(200, NATIVE_LOGIN_RESPONSE)
    const runtime = createAdminRuntime()

    const principal = await runtime.login({ email: "ops@example.com", password: "Password123!" })

    expect(calls).toEqual(["http://api.test/v1/auth/admin/native/login"])
    expect(principal.permissions).toEqual(["applications.read"])
    expect(runtime.tokenStore.read("admin", "refreshToken")).toBe("r".repeat(43))
  })

  it("carries the operator's permissions on the bearer path, so RequirePermission works on device", async () => {
    asNative()
    stubFetch(200, NATIVE_LOGIN_RESPONSE)
    const runtime = createAdminRuntime()

    const principal = await runtime.login({ email: "ops@example.com", password: "Password123!" })

    expect(principal.roles).toEqual(["superadmin"])
    expect(principal.permissions).toEqual(["applications.read"])
  })
})

describe("admin credential persistence", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete window.__BOE_API_BASE__
  })

  it("never writes a bearer secret to localStorage in a browser", () => {
    const runtime = createAdminRuntime()

    runtime.tokenStore.update("admin", { accessToken: "access", refreshToken: "refresh" })

    expect(runtime.tokenStore.read("admin", "accessToken")).toBe("access")
    expect(localStorage.getItem(ACCESS_KEY)).toBeNull()
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
  })

  it("keeps the bearer pair out of localStorage on a native shell too", async () => {
    asNative()
    const runtime = createAdminRuntime()

    runtime.tokenStore.update("admin", { accessToken: "access", refreshToken: "refresh" })
    await Promise.resolve()

    expect(localStorage.getItem(ACCESS_KEY)).toBeNull()
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
  })

  it("purges bearer secrets an earlier build leaked into localStorage", () => {
    localStorage.setItem(ACCESS_KEY, "leaked-access")
    localStorage.setItem(REFRESH_KEY, "leaked-refresh")

    createAdminRuntime()

    expect(localStorage.getItem(ACCESS_KEY)).toBeNull()
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull()
  })

  it("enrols the admin APK as a device of its own, distinct from the investor APK", async () => {
    asNative()
    stubFetch(200, NATIVE_LOGIN_RESPONSE)
    localStorage.setItem(CLIENT_INSTALLATION_KEY, "00000000-0000-4000-8000-0000000000ff")

    await createAdminRuntime().login({ email: "ops@example.com", password: "Password123!" })

    const adminInstallation = localStorage.getItem(INSTALLATION_KEY)
    expect(adminInstallation).not.toBeNull()
    expect(adminInstallation).not.toBe(localStorage.getItem(CLIENT_INSTALLATION_KEY))
  })
})

const HOLD_SLOT = "create-client"
const HOLD_MONTH = "2026-11"
const OWN_SCHEDULE = "00000000-0000-4000-8000-000000000006"
const OTHER_ADMIN_ID = "00000000-0000-4000-8000-0000000000b2"
const OTHER_SLOT = "record:other"
const OTHER_SCHEDULE = "00000000-0000-4000-8000-000000000007"

const holdWritesOf = (adminId: string, slot: string, scheduleId: string): void => {
  keepHold(slot, adminId, {
    idempotencyKey: mintIdempotencyKey(),
    body: { fullName: "Asha Rao", email: "asha@example.com", phone: "+919800000000" },
  })
  keepHeldRecording(adminId, {
    idempotencyKey: mintIdempotencyKey(),
    userId: "00000000-0000-4000-8000-000000000003",
    body: {
      fundId: "00000000-0000-4000-8000-000000000005",
      amountPaise: "500000",
      effectiveDate: "2026-11-05",
      reasonCode: MONTHLY_REASON,
      sipScheduleLink: { scheduleId, month: HOLD_MONTH },
    },
  })
}

const holdClientWrites = (): void => {
  holdWritesOf(OPERATOR.userId, HOLD_SLOT, OWN_SCHEDULE)
}

const heldWritesInTab = (): number =>
  (loadHold(HOLD_SLOT, OPERATOR.userId, (value) => value) === null ? 0 : 1) +
  loadHeldRecordings(HOLD_MONTH, OPERATOR.userId).size

const failure = (code: string): unknown => ({
  ok: false,
  data: null,
  error: { code, message: `${code} happened`, retryable: false },
  meta: META,
})

const readSession = (runtime: AdminRuntime): Promise<unknown> => {
  runtime.tokenStore.set("admin", "principal", JSON.stringify(OPERATOR))
  return runtime.http.request(getAdminSession, {}).catch(() => null)
}

const signOut = (runtime: AdminRuntime): Promise<unknown> => {
  runtime.tokenStore.set("admin", "principal", JSON.stringify(OPERATOR))
  return runtime.logout()
}

describe("admin session end", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete window.__BOE_API_BASE__
    sessionStorage.clear()
  })

  it.each([
    {
      way: "the operator signs out",
      status: 200,
      body: { ok: true, data: null, error: null, meta: META },
      end: signOut,
      ends: [],
    },
    { way: "the server revokes the session", status: 401, body: failure("SESSION_INVALID"), end: readSession, ends: [{ scope: "admin", reason: "revoked" }] },
    { way: "the session expires and the refresh fails", status: 401, body: failure("AUTHENTICATION_REQUIRED"), end: readSession, ends: [{ scope: "admin", reason: "expired" }] },
  ])("leaves no held write in the tab when $way", async ({ status, body, end, ends }) => {
    holdClientWrites()
    expect(heldWritesInTab()).toBe(2)
    stubFetch(status, body)
    const ended = listenForSessionEnd()

    await end(createAdminRuntime())

    expect(ended()).toEqual(ends)
    expect(heldWritesInTab()).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})

const SESSION_RESPONSE = { ok: true, data: OPERATOR, error: null, meta: META }

const CREDENTIALS = { email: "ops@example.com", password: "Password123!" }

const restoreNativeSession = (runtime: AdminRuntime): Promise<unknown> => {
  runtime.tokenStore.update("admin", { accessToken: "a".repeat(120), principal: JSON.stringify(OPERATOR) })
  return runtime.restore()
}

describe("admin session start", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete window.__BOE_API_BASE__
    sessionStorage.clear()
  })

  it.each([
    { way: "a browser signs in", native: false, body: COOKIE_LOGIN_RESPONSE, start: (runtime: AdminRuntime) => runtime.login(CREDENTIALS) },
    { way: "the admin APK signs in", native: true, body: NATIVE_LOGIN_RESPONSE, start: (runtime: AdminRuntime) => runtime.login(CREDENTIALS) },
    { way: "the admin APK restores its session", native: true, body: SESSION_RESPONSE, start: restoreNativeSession },
  ])("keeps the admin's own held writes and drops another admin's when $way", async ({ native, body, start }) => {
    if (native) asNative()
    holdWritesOf(OPERATOR.userId, HOLD_SLOT, OWN_SCHEDULE)
    holdWritesOf(OTHER_ADMIN_ID, OTHER_SLOT, OTHER_SCHEDULE)
    expect(sessionStorage.length).toBe(4)
    stubFetch(200, body)

    await start(createAdminRuntime())

    expect(sessionStorage.length).toBe(2)
    expect(loadHold(HOLD_SLOT, OPERATOR.userId, (value) => value)).not.toBeNull()
    expect([...loadHeldRecordings(HOLD_MONTH, OPERATOR.userId).keys()]).toEqual([OWN_SCHEDULE])
  })
})

type Reply = readonly [status: number, body: unknown]

type Sent = Readonly<{ route: string; headers: Headers }>

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
    const [status, body] = replies[Math.min(index, replies.length - 1)] ?? [404, failure("RESOURCE_NOT_FOUND")]
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }))
  }
  return sent
}

const settle = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0)
  })

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

const OTHER_OPERATOR = { ...OPERATOR, userId: OTHER_ADMIN_ID, fullName: "Other Operator", email: "other@example.com" }

type Operator = typeof OPERATOR

const csrfFor = (user: Operator): unknown => ({
  ok: true,
  data: { user, csrfToken: `csrf-of-${user.userId}`, csrfTokenExpiresAt: "2026-01-01T00:00:00.000Z" },
  error: null,
  meta: META,
})

const refreshedAs = (user: Operator): unknown => ({
  ok: true,
  data: { ...COOKIE_LOGIN_RESPONSE.data, user, csrfToken: `rotated-csrf-of-${user.userId}` },
  error: null,
  meta: META,
})

const FAQ_ID = "00000000-0000-4000-8000-0000000000f1"
const WRITE_KEY = "held-write-key-0001"
const ARCHIVE = `DELETE /v1/admin/faqs/${FAQ_ID}`
const CSRF = "GET /v1/auth/web/csrf"
const REFRESH = "POST /v1/auth/web/refresh"

const ARCHIVED = {
  ok: true,
  data: {
    faq: {
      id: FAQ_ID,
      contentKey: "faq-returns",
      question: "When are values updated?",
      answer: "Every month.",
      category: "general",
      order: 1,
      status: "archived",
      version: 2,
      publishedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
  },
  error: null,
  meta: META,
}

const signedInTab = (): AdminRuntime => {
  const runtime = createAdminRuntime()
  runtime.tokenStore.update("admin", { csrfToken: "csrf-of-the-tab", principal: JSON.stringify(OPERATOR) })
  return runtime
}

const archiveFaq = (runtime: AdminRuntime) =>
  runtime.http.request(archiveAdminFaq, { params: { faqId: FAQ_ID }, idempotencyKey: WRITE_KEY })

describe("admin cookie refresh after another admin signs in to the browser", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete window.__BOE_API_BASE__
    sessionStorage.clear()
  })

  it("ends the tab's session without rotating the other admin's session or resending the write as them", async () => {
    holdClientWrites()
    const sent = routeFetch({
      [ARCHIVE]: [[401, failure("AUTHENTICATION_REQUIRED")], [200, ARCHIVED]],
      [CSRF]: [[200, csrfFor(OTHER_OPERATOR)]],
      [REFRESH]: [[200, refreshedAs(OTHER_OPERATOR)]],
    })
    const ended = listenForSessionEnd()
    const runtime = signedInTab()
    localStorage.setItem(PRINCIPAL_KEY, JSON.stringify(OTHER_OPERATOR))

    await expect(archiveFaq(runtime)).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" })
    await settle()

    expect(sent.map(({ route }) => route)).toEqual([ARCHIVE, CSRF])
    expect(ended()).toEqual([{ scope: "admin", reason: "revoked" }])
    expect(runtime.tokenStore.read("admin", "principal")).toBeNull()
    expect(runtime.tokenStore.read("admin", "csrfToken")).toBeNull()
    expect(heldWritesInTab()).toBe(0)
    expect(localStorage.getItem(PRINCIPAL_KEY)).toBe(JSON.stringify(OTHER_OPERATOR))
  })

  it("ends the tab's session without resending when the refresh names another admin than the CSRF recovery did", async () => {
    const sent = routeFetch({
      [ARCHIVE]: [[401, failure("AUTHENTICATION_REQUIRED")], [200, ARCHIVED]],
      [CSRF]: [[200, csrfFor(OPERATOR)]],
      [REFRESH]: [[200, refreshedAs(OTHER_OPERATOR)]],
    })
    const ended = listenForSessionEnd()
    const runtime = signedInTab()

    await expect(archiveFaq(runtime)).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" })

    expect(sent.map(({ route }) => route)).toEqual([ARCHIVE, CSRF, REFRESH])
    expect(ended()).toEqual([{ scope: "admin", reason: "revoked" }])
    expect(runtime.tokenStore.read("admin", "principal")).toBeNull()
    expect(runtime.tokenStore.read("admin", "csrfToken")).toBeNull()
  })

  it("sends neither a later write nor a sign-out once the tab's session ended because another admin took the cookies", async () => {
    const sent = routeFetch({
      [ARCHIVE]: [[401, failure("AUTHENTICATION_REQUIRED")], [401, failure("AUTHENTICATION_REQUIRED")], [200, ARCHIVED]],
      [CSRF]: [[200, csrfFor(OTHER_OPERATOR)]],
      [REFRESH]: [[200, refreshedAs(OTHER_OPERATOR)]],
    })
    const ended = listenForSessionEnd()
    const runtime = signedInTab()
    await expect(archiveFaq(runtime)).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" })

    await expect(archiveFaq(runtime)).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED", status: 401 })
    await runtime.logout()

    expect(sent.map(({ route }) => route)).toEqual([ARCHIVE, CSRF])
    expect(ended()).toEqual([{ scope: "admin", reason: "revoked" }])
    expect(runtime.tokenStore.read("admin", "principal")).toBeNull()
  })

  it("resends the write once with the same key when the refresh returns the admin the tab holds", async () => {
    const sent = routeFetch({
      [ARCHIVE]: [[401, failure("AUTHENTICATION_REQUIRED")], [200, ARCHIVED]],
      [CSRF]: [[200, csrfFor(OPERATOR)]],
      [REFRESH]: [[200, refreshedAs(OPERATOR)]],
    })
    const ended = listenForSessionEnd()
    const runtime = signedInTab()

    const { data } = await archiveFaq(runtime)

    expect(data.faq.id).toBe(FAQ_ID)
    expect(sent.map(({ route }) => route)).toEqual([ARCHIVE, CSRF, REFRESH, ARCHIVE])
    const writes = sent.filter(({ route }) => route === ARCHIVE)
    expect(writes.map(({ headers }) => headers.get("idempotency-key"))).toEqual([WRITE_KEY, WRITE_KEY])
    expect(writes[1]?.headers.get("x-csrf-token")).toBe(`rotated-csrf-of-${OPERATOR.userId}`)
    expect(ended()).toEqual([])
    expect(JSON.parse(runtime.tokenStore.read("admin", "principal") ?? "null")).toMatchObject({ userId: OPERATOR.userId })
  })
})

const ADMIN_SESSION = "GET /v1/admin/session"

describe("admin browser restore", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete window.__BOE_API_BASE__
  })

  it("holds the admin its cookies name before the first read, so an expired access cookie still refreshes", async () => {
    const sent = routeFetch({
      [CSRF]: [[200, csrfFor(OPERATOR)]],
      [ADMIN_SESSION]: [[401, failure("AUTHENTICATION_REQUIRED")], [200, SESSION_RESPONSE]],
      [REFRESH]: [[200, refreshedAs(OPERATOR)]],
    })
    const ended = listenForSessionEnd()
    const runtime = createAdminRuntime()

    const principal = await runtime.restore()

    expect(principal).toMatchObject({ userId: OPERATOR.userId })
    expect(sent.map(({ route }) => route)).toEqual([CSRF, ADMIN_SESSION, CSRF, REFRESH, ADMIN_SESSION])
    expect(ended()).toEqual([])
    expect(runtime.tokenStore.read("admin", "csrfToken")).toBe(`rotated-csrf-of-${OPERATOR.userId}`)
  })
})
