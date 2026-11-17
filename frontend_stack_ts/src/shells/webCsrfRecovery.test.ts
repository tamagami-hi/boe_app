import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { isUnknownRetryOutcome, isUnknownWriteOutcome } from "~/api/errors"
import {
  archiveAdminFaq,
  getAdminSession,
  getLatestClientNomineeRequest,
  withdrawClientNomineeRequest,
} from "~/api/generated/operations"
import type { HttpClient } from "~/api/http"
import { heldUserId } from "~/api/session/refresh"
import { SESSION_INVALIDATED_EVENT } from "~/api/session/scope"
import type { SessionScope } from "~/api/session/scope"
import type { TokenStore } from "~/api/session/tokenStore"
import { createAdminRuntime } from "~/shells/admin/adminRuntime"
import { createClientRuntime } from "~/shells/client/clientRuntime"

const META = {
  requestId: "00000000-0000-4000-8000-000000000002",
  timestamp: "2026-01-01T00:00:00.000Z",
}

const WRITE_KEY = "held-write-key-0001"
const TAB_CSRF = "csrf-of-the-tab"
const RECOVERED_CSRF = "csrf-recovered-after-the-other-tab"
const REFRESH_CSRF = "csrf-read-by-the-refresh"

type Reply = readonly [status: number, body: unknown]

type Sent = Readonly<{ route: string; headers: Headers }>

type Tab = Readonly<{ tokenStore: TokenStore; http: HttpClient }>

type User = Readonly<{ userId: string }>

const envelope = (data: unknown): unknown => ({ ok: true, data, error: null, meta: META })

const refusal = (code: string, status: number): Reply => [
  status,
  { ok: false, data: null, error: { code, message: `${code} happened`, retryable: false }, meta: META },
]

const CSRF_REFUSED = refusal("CSRF_INVALID", 403)
const EXPIRED = refusal("AUTHENTICATION_REQUIRED", 401)

const PROXY_502_PAGE =
  "<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx</center></body></html>"

const csrfFor = (user: User, csrfToken: string): Reply => [
  200,
  envelope({ user, csrfToken, csrfTokenExpiresAt: "2026-01-01T00:00:00.000Z" }),
]

const refreshedAs = (user: User): Reply => [
  200,
  envelope({
    user,
    csrfToken: `rotated-csrf-of-${user.userId}`,
    accessTokenExpiresAt: "2026-01-01T00:00:00.000Z",
    refreshTokenExpiresAt: "2026-02-01T00:00:00.000Z",
  }),
]

const ADMIN = {
  userId: "00000000-0000-4000-8000-000000000001",
  fullName: "Test Operator",
  email: "ops@example.com",
  roles: ["superadmin"],
  permissions: ["applications.read"],
}

const OTHER_ADMIN = { ...ADMIN, userId: "00000000-0000-4000-8000-0000000000b2", fullName: "Other Operator", email: "other@example.com" }

const INVESTOR = {
  userId: "00000000-0000-4000-8000-000000000001",
  fullName: "Test Investor",
  email: "investor@example.com",
  accountStatus: "active",
}

const OTHER_INVESTOR = { ...INVESTOR, userId: "00000000-0000-4000-8000-0000000000c2", fullName: "Other Investor", email: "other@example.com" }

const FAQ_ID = "00000000-0000-4000-8000-0000000000f1"

const ARCHIVED_FAQ = {
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
}

const NOMINEE_REQUEST_ID = "00000000-0000-4000-8000-0000000000e1"

const WITHDRAWN_REQUEST = {
  id: NOMINEE_REQUEST_ID,
  nominee: { name: "Asha Rao", relation: "Sister" },
  state: "withdrawn",
  declineReason: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  decidedAt: "2026-01-02T00:00:00.000Z",
  version: 2,
}

const signedIn = <TTab extends Tab>(tab: TTab, scope: SessionScope, user: User): TTab => {
  tab.tokenStore.update(scope, { csrfToken: TAB_CSRF, principal: JSON.stringify(user) })
  return tab
}

const SURFACES = [
  {
    surface: "admin web",
    scope: "admin",
    user: ADMIN,
    otherUser: OTHER_ADMIN,
    start: (): Tab => signedIn(createAdminRuntime(), "admin", ADMIN),
    csrfRoute: "GET /v1/auth/web/csrf",
    refreshRoute: "POST /v1/auth/web/refresh",
    writeRoute: `DELETE /v1/admin/faqs/${FAQ_ID}`,
    readRoute: "GET /v1/admin/session",
    written: [200, envelope({ faq: ARCHIVED_FAQ })],
    read: [200, envelope(ADMIN)],
    write: (tab: Tab): Promise<unknown> =>
      tab.http.request(archiveAdminFaq, { params: { faqId: FAQ_ID }, idempotencyKey: WRITE_KEY }),
    readNow: (tab: Tab): Promise<unknown> => tab.http.request(getAdminSession, {}),
  },
  {
    surface: "client web",
    scope: "client",
    user: INVESTOR,
    otherUser: OTHER_INVESTOR,
    start: (): Tab => signedIn(createClientRuntime(), "client", INVESTOR),
    csrfRoute: "GET /v1/auth/client/web/csrf",
    refreshRoute: "POST /v1/auth/client/web/refresh",
    writeRoute: `POST /v1/client/nominee-requests/${NOMINEE_REQUEST_ID}/withdraw`,
    readRoute: "GET /v1/client/nominee-requests/latest",
    written: [200, envelope({ request: WITHDRAWN_REQUEST })],
    read: [200, envelope({ request: null })],
    write: (tab: Tab): Promise<unknown> =>
      tab.http.request(withdrawClientNomineeRequest, {
        params: { requestId: NOMINEE_REQUEST_ID },
        body: { expectedVersion: 1 },
        idempotencyKey: WRITE_KEY,
      }),
    readNow: (tab: Tab): Promise<unknown> => tab.http.request(getLatestClientNomineeRequest, {}),
  },
] as const

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
    const [status, body] = replies[Math.min(index, replies.length - 1)] ?? refusal("RESOURCE_NOT_FOUND", 404)
    const text = typeof body === "string" ? body : JSON.stringify(body)
    const type = typeof body === "string" ? "text/html" : "application/json"
    return Promise.resolve(new Response(text, { status, headers: { "content-type": type } }))
  }
  return sent
}

const routesOf = (sent: readonly Sent[]): readonly string[] => sent.map(({ route }) => route)

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

describe("a web write refused CSRF_INVALID because another tab rotated the token", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    delete window.Capacitor
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete window.__BOE_API_BASE__
    localStorage.clear()
    sessionStorage.clear()
  })

  it.each(SURFACES)("$surface: re-reads the token once and resends the write with the same key", async ({ scope, user, start, csrfRoute, writeRoute, written, write }) => {
    const sent = routeFetch({ [writeRoute]: [CSRF_REFUSED, written], [csrfRoute]: [csrfFor(user, RECOVERED_CSRF)] })
    const ended = listenForSessionEnd()
    const tab = start()

    await write(tab)

    expect(routesOf(sent)).toEqual([writeRoute, csrfRoute, writeRoute])
    const writes = sent.filter(({ route }) => route === writeRoute)
    expect(writes.map(({ headers }) => headers.get("idempotency-key"))).toEqual([WRITE_KEY, WRITE_KEY])
    expect(writes.map(({ headers }) => headers.get("x-csrf-token"))).toEqual([TAB_CSRF, RECOVERED_CSRF])
    expect(tab.tokenStore.read(scope, "csrfToken")).toBe(RECOVERED_CSRF)
    expect(heldUserId(tab.tokenStore, scope)).toBe(user.userId)
    expect(ended()).toEqual([])
  })

  it.each(SURFACES)("$surface: ends the session without resending when the recovery names another user", async ({ scope, otherUser, start, csrfRoute, writeRoute, written, write }) => {
    const sent = routeFetch({ [writeRoute]: [CSRF_REFUSED, written], [csrfRoute]: [csrfFor(otherUser, RECOVERED_CSRF)] })
    const ended = listenForSessionEnd()
    const tab = start()

    await expect(write(tab)).rejects.toMatchObject({ code: "CSRF_INVALID", status: 403 })

    expect(routesOf(sent)).toEqual([writeRoute, csrfRoute])
    expect(ended()).toEqual([{ scope, reason: "revoked" }])
    expect(heldUserId(tab.tokenStore, scope)).toBeNull()
    expect(tab.tokenStore.read(scope, "csrfToken")).toBeNull()
  })

  it.each(SURFACES)("$surface: sends nothing more and leaves Check again unknown when the resend is refused again", async ({ scope, user, start, csrfRoute, writeRoute, written, write }) => {
    const sent = routeFetch({ [writeRoute]: [CSRF_REFUSED, CSRF_REFUSED, written], [csrfRoute]: [csrfFor(user, RECOVERED_CSRF)] })
    const ended = listenForSessionEnd()
    const tab = start()

    const again = await write(tab).catch((error: unknown) => error)

    expect(again).toMatchObject({ code: "CSRF_INVALID", status: 403 })
    expect(isUnknownRetryOutcome(again)).toBe(true)
    expect(routesOf(sent)).toEqual([writeRoute, csrfRoute, writeRoute])
    expect(ended()).toEqual([])
    expect(heldUserId(tab.tokenStore, scope)).toBe(user.userId)
  })

  it.each(SURFACES)("$surface: keeps the session and the write unknown when the recovery meets a proxy's 502 page", async ({ scope, user, start, csrfRoute, writeRoute, written, write }) => {
    const outage: Reply = [502, PROXY_502_PAGE]
    const sent = routeFetch({ [writeRoute]: [CSRF_REFUSED, written], [csrfRoute]: [outage, outage, outage, csrfFor(user, RECOVERED_CSRF)] })
    const ended = listenForSessionEnd()
    const tab = start()

    const failure = await write(tab).catch((error: unknown) => error)

    expect(failure).toMatchObject({ status: 502 })
    expect(isUnknownWriteOutcome(failure)).toBe(true)
    expect(routesOf(sent)).toEqual([writeRoute, csrfRoute, csrfRoute, csrfRoute])
    expect(ended()).toEqual([])
    expect(heldUserId(tab.tokenStore, scope)).toBe(user.userId)
  })

  it.each(SURFACES)("$surface: re-reads the token only after a refresh already under way has rotated", async ({ user, start, csrfRoute, refreshRoute, writeRoute, readRoute, written, read, write, readNow }) => {
    const sent = routeFetch({
      [readRoute]: [EXPIRED, read],
      [writeRoute]: [CSRF_REFUSED, written],
      [csrfRoute]: [csrfFor(user, REFRESH_CSRF), csrfFor(user, RECOVERED_CSRF)],
      [refreshRoute]: [refreshedAs(user)],
    })
    const tab = start()

    await Promise.all([readNow(tab), write(tab)])

    const recoveries = routesOf(sent).filter((route) => route === csrfRoute || route === refreshRoute)
    expect(recoveries).toEqual([csrfRoute, refreshRoute, csrfRoute])
    expect(sent.find(({ route }) => route === refreshRoute)?.headers.get("x-csrf-token")).toBe(REFRESH_CSRF)
    expect(sent.filter(({ route }) => route === writeRoute).at(-1)?.headers.get("x-csrf-token")).toBe(RECOVERED_CSRF)
  })
})
