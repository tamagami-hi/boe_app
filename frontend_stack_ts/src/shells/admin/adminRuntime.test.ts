import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { getAdminSession } from "~/api/generated/operations"
import { mintIdempotencyKey } from "~/api/idempotency"
import { keepHeldRecording, loadHeldRecordings } from "~/features/admin/payment-sheet/heldRecordings"
import { MONTHLY_REASON } from "~/features/admin/payment-sheet/recordingSheet"
import { keepHold, loadHold } from "~/features/admin/shared/heldWriteStore"
import { createAdminRuntime } from "~/shells/admin/adminRuntime"
import type { AdminRuntime } from "~/shells/admin/adminRuntime"

const ACCESS_KEY = "boe.admin.accessToken"
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

const holdClientWrites = (): void => {
  keepHold(HOLD_SLOT, {
    idempotencyKey: mintIdempotencyKey(),
    body: { fullName: "Asha Rao", email: "asha@example.com", phone: "+919800000000" },
  })
  keepHeldRecording({
    idempotencyKey: mintIdempotencyKey(),
    userId: "00000000-0000-4000-8000-000000000003",
    body: {
      fundId: "00000000-0000-4000-8000-000000000005",
      amountPaise: "500000",
      effectiveDate: "2026-11-05",
      reasonCode: MONTHLY_REASON,
      sipScheduleLink: { scheduleId: "00000000-0000-4000-8000-000000000006", month: HOLD_MONTH },
    },
  })
}

const heldWritesInTab = (): number =>
  (loadHold(HOLD_SLOT, (value) => value) === null ? 0 : 1) + loadHeldRecordings(HOLD_MONTH).size

const failure = (code: string): unknown => ({
  ok: false,
  data: null,
  error: { code, message: `${code} happened`, retryable: false },
  meta: META,
})

const readSession = (runtime: AdminRuntime): Promise<unknown> =>
  runtime.http.request(getAdminSession, {}).catch(() => null)

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
      end: (runtime: AdminRuntime) => runtime.logout(),
    },
    { way: "the server revokes the session", status: 401, body: failure("SESSION_INVALID"), end: readSession },
    { way: "the session expires and the refresh fails", status: 401, body: failure("AUTHENTICATION_REQUIRED"), end: readSession },
  ])("leaves no held write in the tab when $way", async ({ status, body, end }) => {
    holdClientWrites()
    expect(heldWritesInTab()).toBe(2)
    stubFetch(status, body)

    await end(createAdminRuntime())

    expect(heldWritesInTab()).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})
