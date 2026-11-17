import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { isUnknownWriteOutcome } from "~/api/errors"
import {
  archiveAdminFaq,
  getAdminSession,
  getLatestClientNomineeRequest,
  withdrawClientNomineeRequest,
} from "~/api/generated/operations"
import { DEFAULT_TIMEOUT_MS } from "~/api/http"
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

const FIRST_CSRF = "csrf-of-generation-0"
const OTHER_SESSION_CSRF = "csrf-of-another-users-session"
const REPLACED_ELSEWHERE_CSRF = "csrf-replaced-by-a-read-in-another-tab"
const STALE_CSRF = "csrf-from-before-another-tabs-read"
const WRITE_KEY = "held-write-key-0001"
const FAQ_ID = "00000000-0000-4000-8000-0000000000f1"
const NOMINEE_REQUEST_ID = "00000000-0000-4000-8000-0000000000e1"

type Tab = Readonly<{ tokenStore: TokenStore; http: HttpClient }>

type User = Readonly<{ userId: string }>

type Reply = readonly [status: number, body: unknown]

type CsrfRead = "stable" | "replacing"

interface Server {
  user: User
  csrf: string
  accessFresh: boolean
  revoked: boolean
  generation: number
  csrfReads: number
}

type ServerOptions = Readonly<{
  user: User
  csrfRead: CsrfRead
  accessFresh?: boolean
  before?: (route: string, server: Server) => void
  hang?: (route: string) => boolean
  holdReply?: (route: string) => Promise<void> | undefined
}>

const envelope = (data: unknown): unknown => ({ ok: true, data, error: null, meta: META })

const refusal = (code: string, status: number): Reply => [
  status,
  { ok: false, data: null, error: { code, message: `${code} happened`, retryable: false }, meta: META },
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
  tab.tokenStore.update(scope, { csrfToken: FIRST_CSRF, principal: JSON.stringify(user) })
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
    readRoute: "GET /v1/admin/session",
    probeRoute: "GET /v1/admin/session",
    read: (user: User): unknown => envelope({ ...ADMIN, ...user }),
    probe: (user: User): unknown => envelope({ ...ADMIN, ...user }),
    readNow: (tab: Tab): Promise<unknown> => tab.http.request(getAdminSession, {}),
    freshPrincipal: { fullName: "Test Operator Renamed", permissions: ["applications.read", "clients.create"] },
    writeRoute: `DELETE /v1/admin/faqs/${FAQ_ID}`,
    written: envelope({ faq: ARCHIVED_FAQ }),
    write: (tab: Tab): Promise<unknown> =>
      tab.http.request(archiveAdminFaq, { params: { faqId: FAQ_ID }, idempotencyKey: WRITE_KEY }),
  },
  {
    surface: "client web",
    scope: "client",
    user: INVESTOR,
    otherUser: OTHER_INVESTOR,
    start: (): Tab => signedIn(createClientRuntime(), "client", INVESTOR),
    csrfRoute: "GET /v1/auth/client/web/csrf",
    refreshRoute: "POST /v1/auth/client/web/refresh",
    readRoute: "GET /v1/client/nominee-requests/latest",
    probeRoute: "GET /v1/client/profile",
    read: (): unknown => envelope({ request: null }),
    probe: (user: User): unknown =>
      envelope({
        userId: user.userId,
        fullName: "Profile Name",
        email: INVESTOR.email,
        emailVerification: "verified",
        phone: "+919800000000",
        phoneVerified: false,
        version: 1,
        pendingEmailChange: null,
      }),
    readNow: (tab: Tab): Promise<unknown> => tab.http.request(getLatestClientNomineeRequest, {}),
    freshPrincipal: { fullName: "Test Investor Renamed" },
    writeRoute: `POST /v1/client/nominee-requests/${NOMINEE_REQUEST_ID}/withdraw`,
    written: envelope({ request: WITHDRAWN_REQUEST }),
    write: (tab: Tab): Promise<unknown> =>
      tab.http.request(withdrawClientNomineeRequest, {
        params: { requestId: NOMINEE_REQUEST_ID },
        body: { expectedVersion: 1 },
        idempotencyKey: WRITE_KEY,
      }),
  },
] as const

type Surface = (typeof SURFACES)[number]

const respond = ([status, body]: Reply): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const hangUntilAborted = (signal: AbortSignal | null | undefined): Promise<Response> =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => {
      reject(new DOMException("The request was aborted.", "AbortError"))
    })
  })

const serveSession = (surface: Surface, options: ServerOptions): Readonly<{ server: Server; sent: string[] }> => {
  const server: Server = { user: options.user, csrf: FIRST_CSRF, accessFresh: options.accessFresh ?? false, revoked: false, generation: 0, csrfReads: 0 }
  const sent: string[] = []
  const answer = (route: string, headers: Headers): Reply => {
    if (route === surface.csrfRoute) server.csrfReads += 1
    options.before?.(route, server)
    if (server.revoked) return refusal("SESSION_INVALID", 401)
    if (route === surface.readRoute) return server.accessFresh ? [200, surface.read(server.user)] : refusal("AUTHENTICATION_REQUIRED", 401)
    if (route === surface.probeRoute) return server.accessFresh ? [200, surface.probe(server.user)] : refusal("AUTHENTICATION_REQUIRED", 401)
    if (route === surface.writeRoute) {
      if (!server.accessFresh) return refusal("AUTHENTICATION_REQUIRED", 401)
      return headers.get("x-csrf-token") === server.csrf ? [200, surface.written] : refusal("CSRF_INVALID", 403)
    }
    if (route === surface.csrfRoute) {
      if (options.csrfRead === "replacing") server.csrf = `csrf-replaced-by-read-${String(server.csrfReads)}`
      return [200, envelope({ user: server.user, csrfToken: server.csrf, csrfTokenExpiresAt: "2026-01-01T00:00:00.000Z" })]
    }
    if (route === surface.refreshRoute) {
      if (headers.get("x-csrf-token") !== server.csrf) {
        server.revoked = true
        return refusal("SESSION_INVALID", 401)
      }
      server.generation += 1
      server.csrf = `csrf-of-generation-${String(server.generation)}`
      server.accessFresh = true
      return [200, envelope({
        user: server.user,
        csrfToken: server.csrf,
        accessTokenExpiresAt: "2026-01-01T00:00:00.000Z",
        refreshTokenExpiresAt: "2026-02-01T00:00:00.000Z",
      })]
    }
    return refusal("RESOURCE_NOT_FOUND", 404)
  }
  window.__BOE_API_BASE__ = "http://api.test"
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    const route = `${init?.method ?? "GET"} ${new URL(url).pathname}`
    sent.push(route)
    if (options.hang?.(route) === true) return hangUntilAborted(init?.signal)
    const reply = answer(route, new Headers(init?.headers))
    return (options.holdReply?.(route) ?? Promise.resolve()).then(() => respond(reply))
  }
  return { server, sent }
}

type LockCallback = (lock: Lock | null) => unknown

const createLockManager = (): LockManager => {
  const tails = new Map<string, Promise<unknown>>()
  const request = (name: string, ...rest: readonly [LockCallback] | readonly [LockOptions, LockCallback]): Promise<unknown> => {
    const [options, callback]: readonly [LockOptions, LockCallback] = rest.length === 1 ? [{}, rest[0]] : rest
    const previous = tails.get(name) ?? Promise.resolve()
    const pending = { waiting: true }
    const outcome = new Promise<unknown>((resolve, reject) => {
      options.signal?.addEventListener("abort", () => {
        if (!pending.waiting) return
        pending.waiting = false
        reject(new DOMException("The lock request was aborted.", "AbortError"))
      })
      void previous.then(() => {
        if (!pending.waiting) return
        pending.waiting = false
        resolve(callback({ name, mode: "exclusive" }))
      })
    })
    tails.set(name, previous.then(() => outcome).catch(() => undefined))
    return outcome
  }
  return { request, query: () => Promise.resolve({ held: [], pending: [] }) }
}

const shareLocks = (): void => {
  Object.defineProperty(navigator, "locks", { value: createLockManager(), configurable: true })
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

const nextTask = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0)
  })

const countOf = (sent: readonly string[], route: string): number => sent.filter((each) => each === route).length

describe("two tabs of one web session whose access cookie expired", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    delete window.Capacitor
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete window.__BOE_API_BASE__
    vi.useRealTimers()
    Reflect.deleteProperty(navigator, "locks")
    localStorage.clear()
    sessionStorage.clear()
  })

  it.each(SURFACES)("$surface: sends exactly one refresh when both tabs read at once, and both stay signed in as the server now names them", async (surface) => {
    shareLocks()
    const { server, sent } = serveSession(surface, { user: { ...surface.user, ...surface.freshPrincipal }, csrfRead: "stable" })
    const ended = listenForSessionEnd()
    const tabs = [surface.start(), surface.start()]

    await Promise.all(tabs.map((tab) => surface.readNow(tab)))

    expect(countOf(sent, surface.refreshRoute)).toBe(1)
    expect(server.revoked).toBe(false)
    expect(ended()).toEqual([])
    expect(tabs.map((tab) => heldUserId(tab.tokenStore, surface.scope))).toEqual([surface.user.userId, surface.user.userId])
    expect(tabs.map((tab) => tab.tokenStore.read(surface.scope, "csrfToken"))).toEqual([server.csrf, server.csrf])
    const principals = tabs.map((tab) => JSON.parse(tab.tokenStore.read(surface.scope, "principal") ?? "null") as unknown)
    expect(principals).toMatchObject([surface.freshPrincipal, surface.freshPrincipal])
  })

  it.each(SURFACES)("$surface: fails a tab that waits on the lock past the transport timeout, keeping its session and the outcome unknown", async (surface) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    shareLocks()
    const { sent } = serveSession(surface, { user: surface.user, csrfRead: "stable", hang: (route) => route === surface.csrfRoute })
    const ended = listenForSessionEnd()
    const [first, second] = [surface.start(), surface.start()]
    const firstRead = surface.readNow(first).catch((error: unknown) => error)
    const waiting = { settled: false }
    const secondRead = surface.readNow(second).catch((error: unknown) => error).finally(() => {
      waiting.settled = true
    })

    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS)

    expect(waiting.settled).toBe(true)
    const timedOut = await secondRead
    expect(timedOut).toMatchObject({ name: "TransportError", kind: "timeout" })
    expect(isUnknownWriteOutcome(timedOut)).toBe(true)
    expect(countOf(sent, surface.csrfRoute)).toBe(1)

    await vi.advanceTimersByTimeAsync(4 * DEFAULT_TIMEOUT_MS)

    expect(await firstRead).toMatchObject({ name: "TransportError", kind: "timeout" })
    expect(ended()).toEqual([])
    expect([first, second].map((tab) => heldUserId(tab.tokenStore, surface.scope))).toEqual([surface.user.userId, surface.user.userId])
  })

  it.each(SURFACES)("$surface: holds another tab's CSRF_INVALID recovery until a refresh under way has rotated, so neither revokes", async (surface) => {
    shareLocks()
    const release = { reply: (): void => undefined }
    const refusalHeld = new Promise<void>((resolve) => {
      release.reply = resolve
    })
    const seen = { writes: 0, csrfReads: 0 }
    const { server, sent } = serveSession(surface, {
      user: surface.user,
      csrfRead: "replacing",
      accessFresh: true,
      before: (route, state) => {
        if (route === surface.readRoute && countOf(sent, surface.readRoute) === 1) state.accessFresh = false
        if (route === surface.csrfRoute && state.csrfReads === 1) release.reply()
      },
      holdReply: (route) => {
        if (route === surface.csrfRoute) {
          seen.csrfReads += 1
          return seen.csrfReads === 1 ? nextTask() : undefined
        }
        if (route !== surface.writeRoute) return undefined
        seen.writes += 1
        return seen.writes === 1 ? refusalHeld : undefined
      },
    })
    const ended = listenForSessionEnd()
    const [reader, writer] = [surface.start(), surface.start()]
    writer.tokenStore.set(surface.scope, "csrfToken", STALE_CSRF)

    const outcomes = await Promise.allSettled([surface.write(writer), surface.readNow(reader)])

    expect(outcomes.map(({ status }) => status)).toEqual(["fulfilled", "fulfilled"])
    expect(sent.filter((route) => route === surface.csrfRoute || route === surface.refreshRoute)).toEqual([
      surface.csrfRoute,
      surface.refreshRoute,
      surface.csrfRoute,
    ])
    expect(server.revoked).toBe(false)
    expect(ended()).toEqual([])
    expect(writer.tokenStore.read(surface.scope, "csrfToken")).toBe(server.csrf)
  })

  it.each(SURFACES)("$surface: sends one refresh and no revoke against a backend whose CSRF read replaces the token", async (surface) => {
    shareLocks()
    const { server, sent } = serveSession(surface, { user: surface.user, csrfRead: "replacing" })
    const ended = listenForSessionEnd()
    const tabs = [surface.start(), surface.start()]

    await Promise.all(tabs.map((tab) => surface.readNow(tab)))

    expect(countOf(sent, surface.refreshRoute)).toBe(1)
    expect(server.revoked).toBe(false)
    expect(ended()).toEqual([])
    expect(tabs.map((tab) => heldUserId(tab.tokenStore, surface.scope))).toEqual([surface.user.userId, surface.user.userId])
    expect(tabs[1]?.tokenStore.read(surface.scope, "csrfToken")).toBe(server.csrf)
  })

  it.each(SURFACES)("$surface: ends the waiting tab without a resend when its session read names another user", async (surface) => {
    shareLocks()
    const switched = { done: false }
    const { server } = serveSession(surface, {
      user: surface.user,
      csrfRead: "stable",
      before: (route, state) => {
        if (switched.done || route !== surface.probeRoute || state.csrfReads < 2) return
        switched.done = true
        state.user = surface.otherUser
        state.csrf = OTHER_SESSION_CSRF
        localStorage.setItem(`boe.${surface.scope}.csrfToken`, OTHER_SESSION_CSRF)
        localStorage.setItem(`boe.${surface.scope}.principal`, JSON.stringify(surface.otherUser))
      },
    })
    const ended = listenForSessionEnd()
    const [first, second] = [surface.start(), surface.start()]

    const outcomes = await Promise.allSettled([surface.readNow(first), surface.readNow(second)])

    expect(switched.done).toBe(true)
    expect(outcomes.map(({ status }) => status)).toEqual(["fulfilled", "rejected"])
    expect(outcomes[1]).toMatchObject({ reason: { code: "AUTHENTICATION_REQUIRED" } })
    expect(server.generation).toBe(1)
    expect(server.revoked).toBe(false)
    expect(ended()).toEqual([{ scope: surface.scope, reason: "revoked" }])
    expect(heldUserId(second.tokenStore, surface.scope)).toBeNull()
  })

  it.each(SURFACES)("$surface: still refreshes when the stored token changed but the access cookie has not been renewed", async (surface) => {
    shareLocks()
    const { server, sent } = serveSession(surface, {
      user: surface.user,
      csrfRead: "stable",
      before: (route, state) => {
        if (route !== surface.csrfRoute || state.csrfReads !== 1) return
        state.csrf = REPLACED_ELSEWHERE_CSRF
        localStorage.setItem(`boe.${surface.scope}.csrfToken`, REPLACED_ELSEWHERE_CSRF)
      },
    })
    const ended = listenForSessionEnd()
    const tab = surface.start()

    await surface.readNow(tab)

    expect(sent).toEqual([surface.readRoute, surface.csrfRoute, surface.probeRoute, surface.refreshRoute, surface.readRoute])
    expect(server.revoked).toBe(false)
    expect(ended()).toEqual([])
    expect(tab.tokenStore.read(surface.scope, "csrfToken")).toBe(server.csrf)
  })

  it.each(SURFACES)("$surface: refreshes a single tab as before where Web Locks is missing", async (surface) => {
    const { server, sent } = serveSession(surface, { user: surface.user, csrfRead: "stable" })
    const ended = listenForSessionEnd()
    const tab = surface.start()

    await surface.readNow(tab)

    expect(sent).toEqual([surface.readRoute, surface.csrfRoute, surface.refreshRoute, surface.readRoute])
    expect(server.revoked).toBe(false)
    expect(ended()).toEqual([])
    expect(heldUserId(tab.tokenStore, surface.scope)).toBe(surface.user.userId)
    expect(tab.tokenStore.read(surface.scope, "csrfToken")).toBe(server.csrf)
  })
})
