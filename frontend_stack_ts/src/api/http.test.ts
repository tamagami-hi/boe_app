import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { createSuccessEnvelopeSchema } from "@beonedge/contracts"

import { createHttpClient, READ_RETRY_DELAYS_MS } from "~/api/http"
import type { AnyOperation } from "~/api/http"
import { ApiError, ConfigurationMismatchError, TransportError } from "~/api/errors"
import { createRefreshCoordinator } from "~/api/session/refresh"
import type { RefreshOutcome } from "~/api/session/refresh"
import { createTokenStore, createWebPersistence } from "~/api/session/tokenStore"
import { SESSION_INVALIDATED_EVENT } from "~/api/session/scope"

const ProbeData = z.strictObject({ value: z.string() })
const ProbeEnvelope = createSuccessEnvelopeSchema(ProbeData)

const readOperation = {
  operationId: "probeRead",
  method: "GET",
  path: "/v1/probe/{probeId}",
  authChannel: "native-bearer",
  idempotency: "naturally-idempotent",
  request: { params: z.strictObject({ probeId: z.string() }) },
  success: { status: 200, schema: ProbeEnvelope },
  errorCodes: ["RESOURCE_NOT_FOUND"],
} as const satisfies AnyOperation

const writeOperation = {
  operationId: "probeWrite",
  method: "POST",
  path: "/v1/probe",
  authChannel: "native-bearer",
  idempotency: "required-key",
  request: { body: z.strictObject({ amountPaise: z.string() }) },
  success: { status: 201, schema: ProbeEnvelope },
  errorCodes: ["VALIDATION_FAILED"],
} as const satisfies AnyOperation

const META = {
  requestId: "11111111-1111-4111-8111-111111111111",
  timestamp: "2026-08-28T10:00:00.000Z",
}

const successBody = (value: string): unknown => ({
  ok: true,
  data: { value },
  error: null,
  meta: META,
})

const errorBody = (code: string, retryable: boolean): unknown => ({
  ok: false,
  data: null,
  error: { code, message: `${code} happened`, retryable },
  meta: META,
})

const jsonResponse = (body: unknown, status: number, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })

const newTokenStore = () =>
  createTokenStore({ persistence: createWebPersistence(), persistSecrets: false })

interface Harness {
  readonly fetchImpl: ReturnType<typeof vi.fn>
  readonly refreshExecute: ReturnType<typeof vi.fn>
  readonly sleep: ReturnType<typeof vi.fn>
  readonly tokenStore: ReturnType<typeof newTokenStore>
  readonly client: ReturnType<typeof createHttpClient>
}

const harness = (refreshOutcome: RefreshOutcome = "rotated"): Harness => {
  const fetchImpl = vi.fn()
  const refreshExecute = vi.fn(() => Promise.resolve(refreshOutcome))
  const sleep = vi.fn(() => Promise.resolve())
  const tokenStore = newTokenStore()
  const client = createHttpClient({
    scope: "client",
    tokenStore,
    refreshCoordinator: createRefreshCoordinator(refreshExecute),
    baseUrl: () => "https://api.test",
    fetchImpl,
    sleep,
  })
  return { fetchImpl, refreshExecute, sleep, tokenStore, client }
}

beforeEach(() => {
  localStorage.clear()
})

describe("request construction", () => {
  it("substitutes path parameters and encodes them", async () => {
    const { fetchImpl, client } = harness()
    fetchImpl.mockResolvedValue(jsonResponse(successBody("ok"), 200))

    await client.request(readOperation, { params: { probeId: "a/b" } })

    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://api.test/v1/probe/a%2Fb")
  })

  it("refuses to build a path with a missing parameter", async () => {
    const { client } = harness()
    await expect(client.request(readOperation, { params: {} })).rejects.toBeInstanceOf(
      ConfigurationMismatchError,
    )
  })

  it("always sends credentials so cookie transport works", async () => {
    const { fetchImpl, client } = harness()
    fetchImpl.mockResolvedValue(jsonResponse(successBody("ok"), 200))

    await client.request(readOperation, { params: { probeId: "p1" } })

    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).credentials).toBe("include")
  })

  it("reads the bearer token synchronously from the token store", async () => {
    const { fetchImpl, tokenStore, client } = harness()
    tokenStore.set("client", "accessToken", "token-value")
    fetchImpl.mockResolvedValue(jsonResponse(successBody("ok"), 200))

    await client.request(readOperation, { params: { probeId: "p1" } })

    const headers = (fetchImpl.mock.calls[0]?.[1] as RequestInit).headers as Headers
    expect(headers.get("authorization")).toBe("Bearer token-value")
  })

  it("sends the CSRF token on writes only", async () => {
    const { fetchImpl, tokenStore, client } = harness()
    tokenStore.set("client", "csrfToken", "csrf-value")
    fetchImpl.mockResolvedValue(jsonResponse(successBody("ok"), 200))

    await client.request(readOperation, { params: { probeId: "p1" } })
    const readHeaders = (fetchImpl.mock.calls[0]?.[1] as RequestInit).headers as Headers
    expect(readHeaders.get("x-csrf-token")).toBeNull()

    fetchImpl.mockResolvedValue(jsonResponse(successBody("ok"), 201))
    await client.request(writeOperation, {
      body: { amountPaise: "200" },
      idempotencyKey: "abcdefgh1234",
    })
    const writeHeaders = (fetchImpl.mock.calls[1]?.[1] as RequestInit).headers as Headers
    expect(writeHeaders.get("x-csrf-token")).toBe("csrf-value")
  })

  it("omits credentials from an unauthenticated request", async () => {
    const { fetchImpl, tokenStore, client } = harness()
    tokenStore.set("client", "accessToken", "token-value")
    fetchImpl.mockResolvedValue(jsonResponse(successBody("ok"), 200))

    await client.request(readOperation, { params: { probeId: "p1" }, unauthenticated: true })

    const headers = (fetchImpl.mock.calls[0]?.[1] as RequestInit).headers as Headers
    expect(headers.get("authorization")).toBeNull()
  })
})

describe("idempotency enforcement", () => {
  it("refuses an operation that requires a key when none is supplied", async () => {
    const { client, fetchImpl } = harness()
    await expect(client.request(writeOperation, { body: { amountPaise: "200" } })).rejects.toBeInstanceOf(
      ConfigurationMismatchError,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("refuses a malformed key rather than letting the backend reject it", async () => {
    const { client, fetchImpl } = harness()
    await expect(
      client.request(writeOperation, { body: { amountPaise: "200" }, idempotencyKey: "short" }),
    ).rejects.toBeInstanceOf(ConfigurationMismatchError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("forwards a valid key", async () => {
    const { fetchImpl, client } = harness()
    fetchImpl.mockResolvedValue(jsonResponse(successBody("ok"), 201))

    await client.request(writeOperation, {
      body: { amountPaise: "200" },
      idempotencyKey: "abcdefgh1234",
    })

    const headers = (fetchImpl.mock.calls[0]?.[1] as RequestInit).headers as Headers
    expect(headers.get("idempotency-key")).toBe("abcdefgh1234")
  })
})

describe("retry policy", () => {
  it("retries a GET on an offline failure and stops at the configured ladder", async () => {
    const { fetchImpl, sleep, client } = harness()
    fetchImpl.mockRejectedValue(new TypeError("network down"))

    await expect(client.request(readOperation, { params: { probeId: "p1" } })).rejects.toBeInstanceOf(
      TransportError,
    )

    expect(fetchImpl).toHaveBeenCalledTimes(READ_RETRY_DELAYS_MS.length + 1)
    expect(sleep.mock.calls.flat()).toEqual([...READ_RETRY_DELAYS_MS])
  })

  it("never retries a write, on any failure", async () => {
    const { fetchImpl, sleep, client } = harness()
    fetchImpl.mockRejectedValue(new TypeError("network down"))

    await expect(
      client.request(writeOperation, {
        body: { amountPaise: "200" },
        idempotencyKey: "abcdefgh1234",
      }),
    ).rejects.toBeInstanceOf(TransportError)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it("never retries a write that failed with a retryable server error", async () => {
    const { fetchImpl, client } = harness()
    fetchImpl.mockResolvedValue(jsonResponse(errorBody("DEPENDENCY_UNAVAILABLE", true), 503))

    await expect(
      client.request(writeOperation, {
        body: { amountPaise: "200" },
        idempotencyKey: "abcdefgh1234",
      }),
    ).rejects.toBeInstanceOf(ApiError)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

})

describe("session recovery", () => {
  it("coalesces concurrent 401s into exactly one rotation", async () => {
    const fetchImpl = vi.fn()
    const tokenStore = newTokenStore()
    const refreshExecute = vi.fn(() => {
      tokenStore.set("client", "accessToken", "rotated")
      return Promise.resolve<RefreshOutcome>("rotated")
    })
    const client = createHttpClient({
      scope: "client",
      tokenStore,
      refreshCoordinator: createRefreshCoordinator(refreshExecute),
      baseUrl: () => "https://api.test",
      fetchImpl,
      sleep: () => Promise.resolve(),
    })

    fetchImpl.mockImplementation((_url: string, init: RequestInit) => {
      const headers = init.headers as Headers
      if (headers.get("authorization") === "Bearer rotated") {
        return Promise.resolve(jsonResponse(successBody("ok"), 200))
      }
      return Promise.resolve(jsonResponse(errorBody("AUTHENTICATION_REQUIRED", false), 401))
    })

    const results = await Promise.all([
      client.request(readOperation, { params: { probeId: "p1" } }),
      client.request(readOperation, { params: { probeId: "p2" } }),
      client.request(readOperation, { params: { probeId: "p3" } }),
    ])

    expect(results.map((result) => result.data.value)).toEqual(["ok", "ok", "ok"])
    expect(refreshExecute).toHaveBeenCalledTimes(1)
  })

  it("does not attempt a rotation when the family is already revoked", async () => {
    const { fetchImpl, refreshExecute, client } = harness()
    fetchImpl.mockResolvedValue(jsonResponse(errorBody("SESSION_INVALID", false), 401))

    await expect(client.request(readOperation, { params: { probeId: "p1" } })).rejects.toBeInstanceOf(
      ApiError,
    )

    expect(refreshExecute).not.toHaveBeenCalled()
  })

  it("clears the scope and announces the end of the session on a revoked family", async () => {
    const { fetchImpl, tokenStore, client } = harness()
    tokenStore.set("client", "accessToken", "stale")
    fetchImpl.mockResolvedValue(jsonResponse(errorBody("SESSION_INVALID", false), 401))

    const seen: string[] = []
    const listener = (event: Event): void => {
      seen.push((event as CustomEvent<{ reason: string }>).detail.reason)
    }
    window.addEventListener(SESSION_INVALIDATED_EVENT, listener)

    await expect(client.request(readOperation, { params: { probeId: "p1" } })).rejects.toBeInstanceOf(
      ApiError,
    )

    window.removeEventListener(SESSION_INVALIDATED_EVENT, listener)
    expect(seen).toEqual(["revoked"])
    expect(tokenStore.read("client", "accessToken")).toBeNull()
  })

  it("does not touch the session when an unauthenticated call returns 401", async () => {
    const { fetchImpl, refreshExecute, tokenStore, client } = harness()
    tokenStore.set("client", "accessToken", "kept")
    fetchImpl.mockResolvedValue(jsonResponse(errorBody("AUTHENTICATION_REQUIRED", false), 401))

    await expect(
      client.request(readOperation, { params: { probeId: "p1" }, unauthenticated: true }),
    ).rejects.toBeInstanceOf(ApiError)

    expect(refreshExecute).not.toHaveBeenCalled()
    expect(tokenStore.read("client", "accessToken")).toBe("kept")
  })

  it("ends the session when the rotation itself fails", async () => {
    const { fetchImpl, tokenStore, client } = harness("unauthenticated")
    tokenStore.set("client", "accessToken", "stale")
    fetchImpl.mockResolvedValue(jsonResponse(errorBody("AUTHENTICATION_REQUIRED", false), 401))

    await expect(client.request(readOperation, { params: { probeId: "p1" } })).rejects.toBeInstanceOf(
      ApiError,
    )

    expect(tokenStore.read("client", "accessToken")).toBeNull()
  })
})

describe("response handling", () => {
  it("rejects a success body that does not match the contract", async () => {
    const { fetchImpl, client } = harness()
    fetchImpl.mockResolvedValue(
      jsonResponse({ ok: true, data: { value: 7 }, error: null, meta: META }, 200),
    )

    await expect(client.request(readOperation, { params: { probeId: "p1" } })).rejects.toBeInstanceOf(
      TransportError,
    )
  })

  it("reports a body that is not JSON as malformed, not as a server error", async () => {
    const { fetchImpl, client } = harness()
    fetchImpl.mockResolvedValue(
      new Response("<html>gateway</html>", { status: 200, headers: { "content-type": "text/html" } }),
    )

    const failure = await client
      .request(readOperation, { params: { probeId: "p1" } })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(TransportError)
    expect((failure as TransportError).kind).toBe("malformed")
  })
})

describe("deadline", () => {
  it("covers the body read, not only the response headers", async () => {
    const fetchImpl = vi.fn()
    const client = createHttpClient({
      scope: "client",
      tokenStore: newTokenStore(),
      refreshCoordinator: createRefreshCoordinator(() => Promise.resolve<RefreshOutcome>("rotated")),
      baseUrl: () => "https://api.test",
      fetchImpl,
      sleep: () => Promise.resolve(),
    })

    fetchImpl.mockImplementation((_url: string, init: RequestInit) => {
      const stalled: Pick<Response, "ok" | "status" | "headers" | "text"> = {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () =>
          new Promise<string>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"))
            })
          }),
      }
      return Promise.resolve(stalled as Response)
    })

    const failure = await client
      .request(readOperation, { params: { probeId: "p1" }, timeoutMs: 25 })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(TransportError)
    expect((failure as TransportError).kind).toBe("timeout")
  })
})
