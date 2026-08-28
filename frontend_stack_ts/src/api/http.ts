import type { z } from "zod"

import { readError, readResponseMeta } from "~/api/envelope"
import type { ResponseMeta } from "~/api/envelope"
import { ApiError, ConfigurationMismatchError, TransportError } from "~/api/errors"
import { emitSessionInvalidated } from "~/api/session/scope"
import type { SessionScope } from "~/api/session/scope"
import type { RefreshCoordinator } from "~/api/session/refresh"
import type { TokenStore } from "~/api/session/tokenStore"
import { isIdempotencyKey } from "~/api/idempotency"
import { resolveApiBase } from "~/lib/env"

export const DEFAULT_TIMEOUT_MS = 20_000
export const READ_RETRY_DELAYS_MS = [300, 900] as const

export type AnyOperation = Readonly<{
  operationId: string
  method: "GET" | "POST" | "PATCH" | "DELETE"
  path: string
  authChannel: string
  idempotency: string
  request: Readonly<{
    body?: z.ZodType
    params?: z.ZodType
    query?: z.ZodType
    headers?: z.ZodType
  }>
  success: Readonly<{ status: number; schema: z.ZodType }>
  errorCodes: readonly string[]
}>

type SuccessEnvelopeOf<TOperation extends AnyOperation> = z.infer<
  TOperation["success"]["schema"]
>

export type DataOf<TOperation extends AnyOperation> =
  SuccessEnvelopeOf<TOperation> extends { data: infer TData } ? TData : never

export type QueryValue = string | number | boolean | null | undefined

export type RequestOptions<TOperation extends AnyOperation> = Readonly<{
  params?: Readonly<Record<string, string>>
  query?: Readonly<Record<string, QueryValue>>
  body?: TOperation["request"]["body"] extends z.ZodType
    ? z.input<NonNullable<TOperation["request"]["body"]>>
    : never
  headers?: Readonly<Record<string, string>>
  idempotencyKey?: string
  ifMatch?: string
  signal?: AbortSignal
  timeoutMs?: number
  unauthenticated?: boolean
}>

export type Result<TOperation extends AnyOperation> = Readonly<{
  data: DataOf<TOperation>
  meta: ResponseMeta
}>

export type TransportOutcome = Readonly<{
  ok: boolean
  kind: "success" | "http" | "timeout" | "offline" | "malformed"
  status: number | null
}>

export type HttpClientDeps = Readonly<{
  scope: SessionScope
  tokenStore: TokenStore
  refreshCoordinator: RefreshCoordinator
  reportOutcome?: (outcome: TransportOutcome) => void
  baseUrl?: () => string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}>

export type HttpClient = Readonly<{
  request: <TOperation extends AnyOperation>(
    operation: TOperation,
    options?: RequestOptions<TOperation>,
  ) => Promise<Result<TOperation>>
}>

const unwrapEnvelopeData = <TOperation extends AnyOperation>(
  validated: unknown,
): DataOf<TOperation> => (validated as { data: DataOf<TOperation> }).data

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const buildPath = (
  template: string,
  params: Readonly<Record<string, string>> | undefined,
): string =>
  template.replace(/\{([A-Za-z0-9_]+)\}/gu, (_match, name: string) => {
    const value = params?.[name]
    if (value === undefined) {
      throw new ConfigurationMismatchError(`Missing path parameter '${name}' for ${template}`)
    }
    return encodeURIComponent(value)
  })

const buildQuery = (query: Readonly<Record<string, QueryValue>> | undefined): string => {
  if (query === undefined) return ""
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    search.append(key, String(value))
  }
  const serialised = search.toString()
  return serialised === "" ? "" : `?${serialised}`
}

const retryAfterFrom = (response: Response): number | undefined => {
  const header = response.headers.get("retry-after")
  if (header === null) return undefined
  const parsed = Number.parseInt(header, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

const isRetryableFailure = (error: unknown): boolean => {
  if (error instanceof TransportError) return error.kind === "timeout" || error.kind === "offline"
  if (error instanceof ApiError) return error.status >= 500 && error.retryable
  return false
}

export const createHttpClient = (deps: HttpClientDeps): HttpClient => {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const sleep = deps.sleep ?? defaultSleep
  const baseUrl = deps.baseUrl ?? resolveApiBase

  const report = (outcome: TransportOutcome): void => {
    deps.reportOutcome?.(outcome)
  }

  const buildHeaders = <TOperation extends AnyOperation>(
    operation: TOperation,
    options: RequestOptions<TOperation>,
    hasBody: boolean,
  ): Headers => {
    const headers = new Headers({ accept: "application/json" })
    if (hasBody) headers.set("content-type", "application/json")

    if (options.unauthenticated !== true) {
      const accessToken = deps.tokenStore.read(deps.scope, "accessToken")
      if (accessToken !== null) headers.set("authorization", `Bearer ${accessToken}`)

      if (operation.method !== "GET") {
        const csrfToken = deps.tokenStore.read(deps.scope, "csrfToken")
        if (csrfToken !== null) headers.set("x-csrf-token", csrfToken)
      }
    }

    if (options.idempotencyKey !== undefined) {
      if (!isIdempotencyKey(options.idempotencyKey)) {
        throw new ConfigurationMismatchError(
          "Idempotency-Key must match /^[A-Za-z0-9._:-]{8,128}$/",
        )
      }
      headers.set("idempotency-key", options.idempotencyKey)
    } else if (operation.idempotency === "required-key" || operation.idempotency === "required") {
      throw new ConfigurationMismatchError(
        `${operation.operationId} requires an Idempotency-Key and none was supplied.`,
      )
    }

    if (options.ifMatch !== undefined) headers.set("if-match", options.ifMatch)

    for (const [key, value] of Object.entries(options.headers ?? {})) {
      headers.set(key, value)
    }

    return headers
  }

  const readBody = async (response: Response): Promise<unknown> => {
    const raw = await response.text()
    if (raw === "") return null
    try {
      return JSON.parse(raw) as unknown
    } catch {
      throw new TransportError("malformed", "The server returned a body that is not valid JSON.")
    }
  }

  const failFromResponse = (response: Response, body: unknown): ApiError => {
    const meta = readResponseMeta(body)
    const parsed = readError(body)
    if (parsed === null) {
      return new ApiError({
        code: "INTERNAL_ERROR",
        message: "The server returned an unrecognised error.",
        status: response.status,
        retryable: response.status >= 500,
        ...(meta.requestId === null ? {} : { requestId: meta.requestId }),
      })
    }
    const retryAfterSeconds = retryAfterFrom(response)
    return new ApiError({
      code: parsed.code,
      message: parsed.message,
      status: response.status,
      retryable: parsed.retryable,
      ...(parsed.fields === null ? {} : { fields: parsed.fields }),
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      ...(meta.requestId === null ? {} : { requestId: meta.requestId }),
    })
  }

  const sendOnce = async <TOperation extends AnyOperation>(
    operation: TOperation,
    options: RequestOptions<TOperation>,
  ): Promise<Result<TOperation>> => {
    const hasBody = options.body !== undefined
    const headers = buildHeaders(operation, options, hasBody)
    const url = `${baseUrl()}${buildPath(operation.path, options.params)}${buildQuery(options.query)}`

    const controller = new AbortController()
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const deadline = { expired: false }
    const timer = setTimeout(() => {
      deadline.expired = true
      controller.abort()
    }, timeoutMs)

    const externalAbort = (): void => {
      controller.abort()
    }
    options.signal?.addEventListener("abort", externalAbort)

    try {
      let response: Response
      try {
        response = await fetchImpl(url, {
          method: operation.method,
          headers,
          credentials: "include",
          signal: controller.signal,
          ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
        })
      } catch (cause) {
        if (deadline.expired) {
          report({ ok: false, kind: "timeout", status: null })
          throw new TransportError("timeout", "The request timed out.")
        }
        if (options.signal?.aborted === true) throw cause
        report({ ok: false, kind: "offline", status: null })
        throw new TransportError("offline", "BeOnEdge could not be reached.")
      }

      let body: unknown
      try {
        body = await readBody(response)
      } catch (cause) {
        if (deadline.expired) {
          report({ ok: false, kind: "timeout", status: null })
          throw new TransportError("timeout", "The request timed out while reading the response.")
        }
        report({ ok: false, kind: "malformed", status: response.status })
        throw cause
      }

      if (!response.ok) {
        report({ ok: false, kind: "http", status: response.status })
        throw failFromResponse(response, body)
      }

      if (response.status !== operation.success.status) {
        report({ ok: false, kind: "malformed", status: response.status })
        throw new TransportError(
          "malformed",
          `${operation.operationId} answered ${String(response.status)} where ${String(operation.success.status)} was contracted.`,
        )
      }

      const validated = operation.success.schema.safeParse(body)
      if (!validated.success) {
        report({ ok: false, kind: "malformed", status: response.status })
        throw new TransportError(
          "malformed",
          `${operation.operationId} returned a response that does not match its contract.`,
        )
      }

      report({ ok: true, kind: "success", status: response.status })
      return {
        data: unwrapEnvelopeData<TOperation>(validated.data),
        meta: readResponseMeta(body),
      }
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", externalAbort)
    }
  }

  const endSession = (reason: "expired" | "revoked"): void => {
    deps.tokenStore.clear(deps.scope)
    emitSessionInvalidated({ scope: deps.scope, reason })
  }

  const sendWithAuthRecovery = async <TOperation extends AnyOperation>(
    operation: TOperation,
    options: RequestOptions<TOperation>,
  ): Promise<Result<TOperation>> => {
    try {
      return await sendOnce(operation, options)
    } catch (error) {
      if (options.unauthenticated === true) throw error
      if (!(error instanceof ApiError) || error.status !== 401) throw error

      if (error.code === "SESSION_INVALID") {
        endSession("revoked")
        throw error
      }
      if (error.code !== "AUTHENTICATION_REQUIRED") throw error

      const outcome = await deps.refreshCoordinator.refreshOnce(deps.scope)
      if (outcome === "unauthenticated") {
        endSession("expired")
        throw error
      }
      return await sendOnce(operation, options)
    }
  }

  const request = async <TOperation extends AnyOperation>(
    operation: TOperation,
    options: RequestOptions<TOperation> = {},
  ): Promise<Result<TOperation>> => {
    const retryable = operation.method === "GET"
    const attempts = retryable ? READ_RETRY_DELAYS_MS.length + 1 : 1

    let lastError: unknown = null
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await sendWithAuthRecovery(operation, options)
      } catch (error) {
        lastError = error
        const delay = READ_RETRY_DELAYS_MS[attempt]
        if (!retryable || delay === undefined || !isRetryableFailure(error)) throw error
        await sleep(delay)
      }
    }
    throw lastError
  }

  return { request }
}
